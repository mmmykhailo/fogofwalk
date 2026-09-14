import { useCallback, useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import { mapStore } from "~/lib/mapStore"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import { MAP_INTERACTIVE_ATTRIBUTE } from "~/components/map/interactiveTargets"

const CLUSTER_PIXEL_RADIUS = 50

interface ProjectedPoint {
  x: number
  y: number
}

export function photoMarkerCacheKey(
  photoRevision: number,
  showPhotos: boolean,
  zoomBucket: number
): string {
  return `${photoRevision}:${showPhotos ? 1 : 0}:${zoomBucket}`
}

export function computePhotoClusters(
  photos: PhotoEntry[],
  project: (coordinates: [number, number]) => ProjectedPoint
): PhotoGroup[] {
  if (photos.length === 0) return []
  const projected = [...photos]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((photo) => {
      const px = project([photo.lng, photo.lat])
      return {
        photo,
        px,
        cellX: Math.floor(px.x / CLUSTER_PIXEL_RADIUS),
        cellY: Math.floor(px.y / CLUSTER_PIXEL_RADIUS),
      }
    })
  const grid = new Map<string, typeof projected>()
  for (const item of projected) {
    const key = `${item.cellX}:${item.cellY}`
    const cell = grid.get(key)
    if (cell) cell.push(item)
    else grid.set(key, [item])
  }
  const assigned = new Set<string>()
  const clusters: PhotoGroup[] = []

  for (const item of projected) {
    if (assigned.has(item.photo.id)) continue
    const members: PhotoEntry[] = [item.photo]
    assigned.add(item.photo.id)

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const candidates = grid.get(
          `${item.cellX + offsetX}:${item.cellY + offsetY}`
        )
        if (!candidates) continue
        for (const other of candidates) {
          if (assigned.has(other.photo.id)) continue
          const dx = item.px.x - other.px.x
          const dy = item.px.y - other.px.y
          if (dx * dx + dy * dy < CLUSTER_PIXEL_RADIUS ** 2) {
            members.push(other.photo)
            assigned.add(other.photo.id)
          }
        }
      }
    }

    members.sort(
      (first, second) =>
        first.takenAtMs - second.takenAtMs || first.id.localeCompare(second.id)
    )
    clusters.push({
      id: members
        .map(({ id }) => id)
        .sort()
        .join("|"),
      photos: members,
      lng: members.reduce((sum, photo) => sum + photo.lng, 0) / members.length,
      lat: members.reduce((sum, photo) => sum + photo.lat, 0) / members.length,
    })
  }

  return clusters
}

function createPhotoMarkerElement(
  group: PhotoGroup,
  onSelect: (group: PhotoGroup) => void,
  ensurePhotoObjectUrl: (photo: PhotoEntry) => string
): {
  element: HTMLDivElement
  update: (nextGroup: PhotoGroup) => void
} {
  let currentGroup = group
  const half = 18
  const element = document.createElement("div")
  element.setAttribute(MAP_INTERACTIVE_ATTRIBUTE, "")
  element.style.cssText = "cursor:pointer;width:0;height:0;position:relative;"

  const render = (nextGroup: PhotoGroup) => {
    while (element.firstChild) element.firstChild.remove()
    const circle = document.createElement("div")
    circle.style.cssText =
      `position:absolute;left:${-half}px;top:${-half}px;` +
      `width:${half * 2}px;height:${half * 2}px;` +
      "border-radius:50%;border:2px solid white;box-sizing:border-box;" +
      "overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.4);"
    const image = document.createElement("img")
    image.src = ensurePhotoObjectUrl(nextGroup.photos[0]!)
    image.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;"
    circle.appendChild(image)
    element.appendChild(circle)

    if (nextGroup.photos.length > 1) {
      const badge = document.createElement("div")
      badge.textContent = String(nextGroup.photos.length)
      badge.style.cssText =
        `position:absolute;left:${half - 6}px;top:${-half - 10}px;` +
        "background:#ff6b35;color:white;border-radius:50%;" +
        "width:16px;height:16px;font-size:9px;font-weight:bold;" +
        "display:flex;align-items:center;justify-content:center;pointer-events:none;"
      element.appendChild(badge)
    }
  }

  render(group)

  element.addEventListener("click", (event) => {
    event.stopPropagation()
    onSelect(currentGroup)
  })
  return {
    element,
    update(nextGroup) {
      currentGroup = nextGroup
      render(nextGroup)
    },
  }
}

function samePhotoGroupContent(first: PhotoGroup, second: PhotoGroup): boolean {
  return (
    first.photos.length === second.photos.length &&
    first.photos.every(
      (photo, index) =>
        photo.id === second.photos[index]?.id &&
        photo.file === second.photos[index]?.file &&
        photo.takenAtMs === second.photos[index]?.takenAtMs
    )
  )
}

function samePhotoGroupPosition(
  first: PhotoGroup,
  second: PhotoGroup
): boolean {
  return first.lng === second.lng && first.lat === second.lat
}

export interface PhotoMarkerDiff {
  nextById: Map<string, PhotoGroup>
  added: Set<string>
  removed: Set<string>
  moved: Set<string>
  updated: Set<string>
}

export function diffPhotoMarkerGroups(
  currentGroups: ReadonlyMap<string, PhotoGroup>,
  nextGroups: readonly PhotoGroup[]
): PhotoMarkerDiff {
  const nextById = new Map(nextGroups.map((group) => [group.id, group]))
  const added = new Set<string>()
  const removed = new Set<string>()
  const moved = new Set<string>()
  const updated = new Set<string>()

  for (const [id, currentGroup] of currentGroups) {
    const nextGroup = nextById.get(id)
    if (!nextGroup) {
      removed.add(id)
      continue
    }
    if (!samePhotoGroupPosition(currentGroup, nextGroup)) moved.add(id)
    if (!samePhotoGroupContent(currentGroup, nextGroup)) updated.add(id)
  }
  for (const id of nextById.keys()) {
    if (!currentGroups.has(id)) added.add(id)
  }

  return { nextById, added, removed, moved, updated }
}

interface PhotoMarkerRecord {
  marker: maplibregl.Marker
  group: PhotoGroup
  update: (group: PhotoGroup) => void
}

export function usePhotoMarkers(
  photos: PhotoEntry[],
  showPhotos: boolean,
  onPhotoSelect: (group: PhotoGroup | null) => void,
  ensurePhotoObjectUrl: (photo: PhotoEntry) => string
): { rebuildPhotoMarkers: () => void } {
  const markersRef = useRef<Map<string, PhotoMarkerRecord>>(new Map())
  const clusterCacheRef = useRef<{
    key: string
    clusters: PhotoGroup[]
  } | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousPhotosRef = useRef(photos)
  const photoRevisionRef = useRef(0)
  if (previousPhotosRef.current !== photos) {
    previousPhotosRef.current = photos
    photoRevisionRef.current++
  }
  const photosRef = useRef(photos)
  photosRef.current = photos
  const showPhotosRef = useRef(showPhotos)
  showPhotosRef.current = showPhotos
  const onPhotoSelectRef = useRef(onPhotoSelect)
  onPhotoSelectRef.current = onPhotoSelect

  const rebuildPhotoMarkers = useCallback(() => {
    const map = mapStore.map
    if (!map) return

    const mapChanged = mapRef.current !== map
    if (mapChanged) {
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      mapRef.current = map
    }

    const zoomBucket = Math.round(map.getZoom())
    const cacheKey = photoMarkerCacheKey(
      photoRevisionRef.current,
      showPhotosRef.current,
      zoomBucket
    )
    if (!mapChanged && clusterCacheRef.current?.key === cacheKey) return

    if (!showPhotosRef.current || photosRef.current.length === 0) {
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      clusterCacheRef.current = { key: cacheKey, clusters: [] }
      return
    }

    let clusters =
      !mapChanged && clusterCacheRef.current?.key === cacheKey
        ? clusterCacheRef.current.clusters
        : undefined
    if (!clusters) {
      clusters = computePhotoClusters(photosRef.current, (coordinates) =>
        map.project(coordinates)
      )
      clusterCacheRef.current = { key: cacheKey, clusters }
    }

    const currentGroups = new Map(
      [...markersRef.current].map(([id, { group }]) => [id, group])
    )
    const diff = diffPhotoMarkerGroups(currentGroups, clusters)
    for (const id of diff.removed) {
      const record = markersRef.current.get(id)
      if (!record) continue
      record.marker.remove()
      markersRef.current.delete(id)
    }

    for (const cluster of clusters) {
      for (const photo of cluster.photos) {
        ensurePhotoObjectUrl(photo)
      }
      const current = markersRef.current.get(cluster.id)
      if (current) {
        if (diff.moved.has(cluster.id)) {
          current.marker.setLngLat([cluster.lng, cluster.lat])
        }
        if (diff.updated.has(cluster.id)) {
          current.update(cluster)
        }
        current.group = cluster
        continue
      }
      const view = createPhotoMarkerElement(
        cluster,
        (selectedGroup) => onPhotoSelectRef.current(selectedGroup),
        ensurePhotoObjectUrl
      )
      const marker = new maplibregl.Marker({ element: view.element })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map)
      markersRef.current.set(cluster.id, {
        marker,
        group: cluster,
        update: view.update,
      })
    }
  }, [ensurePhotoObjectUrl])

  useEffect(() => {
    clusterCacheRef.current = null
    rebuildPhotoMarkers()
  }, [photos, showPhotos, rebuildPhotoMarkers])

  useEffect(
    () => () => {
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      mapRef.current = null
    },
    []
  )

  return { rebuildPhotoMarkers }
}
