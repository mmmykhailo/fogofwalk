import { describe, expect, test } from "bun:test"
import { createPhotoUrlOwner } from "~/lib/photoUrls"
import type { PhotoEntry } from "~/types/photos"

function photo(id: string, fileName = `${id}.jpg`): PhotoEntry {
  return {
    id,
    file: new File([id], fileName, { type: "image/jpeg" }),
    takenAtMs: 1,
    lng: 10,
    lat: 20,
  }
}

describe("photo object URL ownership", () => {
  test("creates once and reuses a URL for the same file", () => {
    const created: string[] = []
    const owner = createPhotoUrlOwner({
      createObjectURL: () => {
        const url = `blob:${created.length + 1}`
        created.push(url)
        return url
      },
      revokeObjectURL: () => undefined,
    })
    const entry = photo("one")

    expect(owner.ensurePhotoObjectUrl(entry)).toBe("blob:1")
    expect(owner.ensurePhotoObjectUrl(entry)).toBe("blob:1")
    expect(created).toEqual(["blob:1"])
    expect(entry.objectUrl).toBe("blob:1")
  })

  test("revokes the old URL when an ID is replaced by another file", () => {
    const revoked: string[] = []
    let next = 0
    const owner = createPhotoUrlOwner({
      createObjectURL: () => `blob:${++next}`,
      revokeObjectURL: (url) => revoked.push(url),
    })
    const first = photo("same")
    const replacement = photo("same", "replacement.jpg")

    expect(owner.ensurePhotoObjectUrl(first)).toBe("blob:1")
    replacement.objectUrl = first.objectUrl
    owner.reconcile([replacement])
    expect(revoked).toEqual(["blob:1"])
    expect(owner.ensurePhotoObjectUrl(replacement)).toBe("blob:2")
  })

  test("revokes removed and remaining URLs exactly once", () => {
    const revoked: string[] = []
    let next = 0
    const owner = createPhotoUrlOwner({
      createObjectURL: () => `blob:${++next}`,
      revokeObjectURL: (url) => revoked.push(url),
    })
    const first = photo("one")
    const second = photo("two")
    owner.ensurePhotoObjectUrl(first)
    owner.ensurePhotoObjectUrl(second)

    owner.reconcile([second])
    owner.reconcile([second])
    owner.revokeAll()
    owner.revokeAll()

    expect(revoked).toEqual(["blob:1", "blob:2"])
  })

  test("does not reuse an object URL after the owner revokes it", () => {
    let next = 0
    const owner = createPhotoUrlOwner({
      createObjectURL: () => `blob:${++next}`,
      revokeObjectURL: () => undefined,
    })
    const entry = photo("reused")

    expect(owner.ensurePhotoObjectUrl(entry)).toBe("blob:1")
    owner.revokeAll()
    expect(entry.objectUrl).toBeUndefined()
    expect(owner.ensurePhotoObjectUrl(entry)).toBe("blob:2")
  })

  test("adopts an existing URL without creating a second one", () => {
    const created: string[] = []
    const revoked: string[] = []
    const owner = createPhotoUrlOwner({
      createObjectURL: () => {
        created.push("created")
        return "blob:new"
      },
      revokeObjectURL: (url) => revoked.push(url),
    })
    const entry = photo("existing")
    entry.objectUrl = "blob:existing"

    expect(owner.ensurePhotoObjectUrl(entry)).toBe("blob:existing")
    owner.revokeAll()
    expect(created).toEqual([])
    expect(revoked).toEqual(["blob:existing"])
  })
})
