import type { PhotoEntry } from "~/types/photos"

export interface PhotoUrlApi {
  createObjectURL: (object: Blob | MediaSource) => string
  revokeObjectURL: (url: string) => void
}

export interface PhotoUrlOwner {
  ensurePhotoObjectUrl(photo: PhotoEntry): string
  reconcile(photos: readonly PhotoEntry[]): void
  revoke(photoId: string): void
  revokeAll(): void
}

interface OwnedPhotoUrl {
  file: File
  url: string
  photo: PhotoEntry
}

/** Owns the document-session object URLs used by map markers and dialogs. */
export function createPhotoUrlOwner(urlApi: PhotoUrlApi = URL): PhotoUrlOwner {
  const ownedUrls = new Map<string, OwnedPhotoUrl>()

  const revoke = (photoId: string) => {
    const owned = ownedUrls.get(photoId)
    if (!owned) return
    ownedUrls.delete(photoId)
    if (owned.photo.objectUrl === owned.url) owned.photo.objectUrl = undefined
    urlApi.revokeObjectURL(owned.url)
  }

  return {
    ensurePhotoObjectUrl(photo) {
      const current = ownedUrls.get(photo.id)
      if (current?.file === photo.file) {
        photo.objectUrl = current.url
        return current.url
      }
      if (current) revoke(photo.id)

      const url = photo.objectUrl ?? urlApi.createObjectURL(photo.file)
      ownedUrls.set(photo.id, { file: photo.file, url, photo })
      photo.objectUrl = url
      return url
    },

    reconcile(photos) {
      const currentById = new Map(photos.map((photo) => [photo.id, photo]))
      for (const [photoId, owned] of ownedUrls) {
        const photo = currentById.get(photoId)
        if (!photo) {
          revoke(photoId)
        } else if (photo.file !== owned.file) {
          revoke(photoId)
          photo.objectUrl = undefined
        }
      }
      for (const photo of photos) {
        const owned = ownedUrls.get(photo.id)
        if (owned) photo.objectUrl = owned.url
      }
    },

    revoke,

    revokeAll() {
      for (const [photoId] of ownedUrls) revoke(photoId)
    },
  }
}
