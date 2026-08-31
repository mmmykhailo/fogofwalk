import { useCallback, useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import { mapStore } from "~/lib/mapStore"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"

const CLUSTER_PIXEL_RADIUS = 50

interface ProjectedPoint {
  x: number
  y: number
}

export function computePhotoClusters(
  photos: PhotoEntry[],
  project: (coordinates: [number, number]) => ProjectedPoint
): PhotoGroup[] {
  if (photos.length === 0) return []
  const projected = photos.map((photo) => ({
    photo,
    px: project([photo.lng, photo.lat]),
  }))
  const assigned = new Set<string>()
  const clusters: PhotoGroup[] = []

  for (const item of projected) {
    if (assigned.has(item.photo.id)) continue
    const members: PhotoEntry[] = [item.photo]
    assigned.add(item.photo.id)

    for (const other of projected) {
      if (assigned.has(other.photo.id)) continue
      const dx = item.px.x - other.px.x
      const dy = item.px.y - other.px.y
      if (Math.hypot(dx, dy) < CLUSTER_PIXEL_RADIUS) {
        members.push(other.photo)
        assigned.add(other.photo.id)
      }
    }

    members.sort((a, b) => a.takenAtMs - b.takenAtMs)
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
  onSelect: () => void
): HTMLDivElement {
  const half = 18
  const element = document.createElement("div")
  element.style.cssText = "cursor:pointer;width:0;height:0;position:relative;"

  const circle = document.createElement("div")
  circle.style.cssText =
    `position:absolute;left:${-half}px;top:${-half}px;` +
    `width:${half * 2}px;height:${half * 2}px;` +
    "border-radius:50%;border:2px solid white;box-sizing:border-box;" +
    "overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.4);"
  const image = document.createElement("img")
  image.src = group.photos[0].objectUrl!
  image.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;"
  circle.appendChild(image)
  element.appendChild(circle)

  if (group.photos.length > 1) {
    const badge = document.createElement("div")
    badge.textContent = String(group.photos.length)
    badge.style.cssText =
      `position:absolute;left:${half - 6}px;top:${-half - 10}px;` +
      "background:#ff6b35;color:white;border-radius:50%;" +
      "width:16px;height:16px;font-size:9px;font-weight:bold;" +
      "display:flex;align-items:center;justify-content:center;pointer-events:none;"
    element.appendChild(badge)
  }

  element.addEventListener("click", (event) => {
    event.stopPropagation()
    onSelect()
  })
  return element
}

export function usePhotoMarkers(
  photos: PhotoEntry[],
  showPhotos: boolean,
  onPhotoSelect: (group: PhotoGroup | null) => void
): { rebuildPhotoMarkers: () => void } {
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const clusterCacheRef = useRef<Map<number, PhotoGroup[]>>(new Map())
  const photosRef = useRef(photos)
  photosRef.current = photos
  const showPhotosRef = useRef(showPhotos)
  showPhotosRef.current = showPhotos
  const onPhotoSelectRef = useRef(onPhotoSelect)
  onPhotoSelectRef.current = onPhotoSelect

  const rebuildPhotoMarkers = useCallback(() => {
    const map = mapStore.map
    if (!map) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()
    if (!showPhotosRef.current || photosRef.current.length === 0) return

    const zoom = Math.round(map.getZoom())
    let clusters = clusterCacheRef.current.get(zoom)
    if (!clusters) {
      clusters = computePhotoClusters(photosRef.current, (coordinates) =>
        map.project(coordinates)
      )
      clusterCacheRef.current.set(zoom, clusters)
    }

    for (const cluster of clusters) {
      for (const photo of cluster.photos) {
        if (!photo.objectUrl) photo.objectUrl = URL.createObjectURL(photo.file)
      }
      const element = createPhotoMarkerElement(cluster, () =>
        onPhotoSelectRef.current(cluster)
      )
      const marker = new maplibregl.Marker({ element })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map)
      markersRef.current.set(cluster.id, marker)
    }
  }, [])

  useEffect(() => {
    clusterCacheRef.current.clear()
    rebuildPhotoMarkers()
  }, [photos, showPhotos, rebuildPhotoMarkers])

  useEffect(
    () => () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current.clear()
    },
    []
  )

  return { rebuildPhotoMarkers }
}
