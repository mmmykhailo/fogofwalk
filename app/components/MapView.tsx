import { useCallback, useEffect, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import type { StyleSpecification } from "maplibre-gl"
import { Protocol } from "pmtiles"
import bbox from "@turf/bbox"
import { featureCollection, lineString } from "@turf/helpers"
import "maplibre-gl/dist/maplibre-gl.css"
import { mapStore, worldFogGeoJSON } from "~/lib/mapStore"
import { saveFogCache } from "~/lib/storage"
import { saveMapPosition } from "~/lib/mapStore"
import {
  MAP_STYLE_URL,
  FOG_COLOR,
  FOG_OPACITY,
  TRACK_COLOR,
  TRACK_WIDTH_DEFAULT,
  TRACK_WIDTH_SELECTED,
  TRACK_OPACITY_DEFAULT,
  TRACK_OPACITY_SELECTED,
  TRACK_OPACITY_DIM,
} from "~/constants/fog"
import type { MapMode, WorkerOutboundMessage } from "~/types/tracks"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import { MapCompass } from "~/components/MapCompass"

const CLUSTER_PIXEL_RADIUS = 50

function computeClusters(
  photos: PhotoEntry[],
  map: maplibregl.Map
): PhotoGroup[] {
  if (photos.length === 0) return []
  const projected = photos.map((p) => ({
    photo: p,
    px: map.project([p.lng, p.lat]),
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
      if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_PIXEL_RADIUS) {
        members.push(other.photo)
        assigned.add(other.photo.id)
      }
    }

    members.sort((a, b) => a.takenAtMs - b.takenAtMs)
    const lng = members.reduce((s, p) => s + p.lng, 0) / members.length
    const lat = members.reduce((s, p) => s + p.lat, 0) / members.length
    clusters.push({
      id: members
        .map((p) => p.id)
        .sort()
        .join("|"),
      photos: members,
      lng,
      lat,
    })
  }

  return clusters
}

const pmtilesProtocol = new Protocol()
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol))

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    },
  },
  layers: [
    { id: "esri-satellite-layer", type: "raster", source: "esri-satellite" },
  ],
}

function setupMapLayers(map: maplibregl.Map, mode: MapMode): void {
  if (mode === "relief") {
    map.addSource("terrain-source", {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
    })
    map.setTerrain({ source: "terrain-source", exaggeration: 2.5 })
  }

  if (mode !== "relief") {
    map.addSource("fog-source", {
      type: "geojson",
      data: mapStore.fogData ?? worldFogGeoJSON(),
    })
    map.addLayer({
      id: "fog-layer",
      type: "fill",
      source: "fog-source",
      paint: {
        "fill-color": FOG_COLOR,
        "fill-opacity": FOG_OPACITY,
      },
    })
  }

  const trackFeatures = mapStore.tracks.map((t) =>
    lineString(t.coordinates, { name: t.name, id: t.id })
  )
  map.addSource("tracks-source", {
    type: "geojson",
    data: featureCollection(trackFeatures),
  })
  map.addLayer({
    id: "tracks-layer",
    type: "line",
    source: "tracks-source",
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "visible",
    },
    paint: {
      "line-color": TRACK_COLOR,
      "line-width": 2,
      "line-opacity": 0.85,
    },
  })

  map.on("mouseenter", "tracks-layer", () => {
    map.getCanvas().style.cursor = "pointer"
  })
  map.on("mouseleave", "tracks-layer", () => {
    map.getCanvas().style.cursor = ""
  })
}

interface MapViewProps {
  onMapReady?: () => void
  onProcessingUpdate?: (count: number, done: boolean) => void
  showTracks: boolean
  showFog: boolean
  selectedTrackIds: string[]
  onTrackSelect: (id: string | null) => void
  mapMode: MapMode
  photos: PhotoEntry[]
  showPhotos: boolean
  onPhotoSelect: (group: PhotoGroup | null) => void
}

export function MapView({
  onMapReady,
  onProcessingUpdate,
  showTracks,
  showFog,
  selectedTrackIds,
  onTrackSelect,
  mapMode,
  photos,
  showPhotos,
  onPhotoSelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onProcessingUpdateRef = useRef(onProcessingUpdate)
  onProcessingUpdateRef.current = onProcessingUpdate
  const onTrackSelectRef = useRef(onTrackSelect)
  onTrackSelectRef.current = onTrackSelect
  const onPhotoSelectRef = useRef(onPhotoSelect)
  onPhotoSelectRef.current = onPhotoSelect
  const showTracksRef = useRef(showTracks)
  showTracksRef.current = showTracks
  const showFogRef = useRef(showFog)
  showFogRef.current = showFog
  const selectedTrackIdsRef = useRef(selectedTrackIds)
  selectedTrackIdsRef.current = selectedTrackIds
  const pendingStyleLoadRef = useRef<(() => void) | null>(null)
  const photoMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const photosRef = useRef<PhotoEntry[]>(photos)
  photosRef.current = photos
  const showPhotosRef = useRef(showPhotos)
  showPhotosRef.current = showPhotos

  const clusterCacheRef = useRef<Map<number, PhotoGroup[]>>(new Map())
  // Cache for the tracks FeatureCollection — only rebuilt when mapStore.tracks.length changes.
  // Prevents redundant GeoJSON reconstruction + GPU re-upload on every 300ms FOG_UPDATE.
  const cachedTracksGeoJSON = useRef<ReturnType<typeof featureCollection> | null>(null)
  const cachedTracksLength = useRef(-1)
  const [bearing, setBearing] = useState(0)
  const [pitch, setPitch] = useState(0)

  const rebuildPhotoMarkers = useCallback(() => {
    const map = mapStore.map
    if (!map) return

    photoMarkersRef.current.forEach((m) => m.remove())
    photoMarkersRef.current.clear()

    if (!showPhotosRef.current || photosRef.current.length === 0) return

    const zoom = Math.round(map.getZoom())
    let clusters = clusterCacheRef.current.get(zoom)
    if (!clusters) {
      clusters = computeClusters(photosRef.current, map)
      clusterCacheRef.current.set(zoom, clusters)
    }

    const HALF = 18 // visual circle radius (36px / 2)

    for (const cluster of clusters) {
      for (const p of cluster.photos) {
        if (!p.objectUrl) p.objectUrl = URL.createObjectURL(p.file)
      }

      // Zero-size anchor: el has 0×0 size so MapLibre places its top-left exactly
      // at the coordinate regardless of anchor. The circle is then positioned so its
      // center sits at that same point using negative left/top offsets.
      const el = document.createElement("div")
      el.style.cssText = "cursor:pointer;width:0;height:0;position:relative;"

      const circle = document.createElement("div")
      circle.style.cssText =
        `position:absolute;left:${-HALF}px;top:${-HALF}px;` +
        `width:${HALF * 2}px;height:${HALF * 2}px;` +
        "border-radius:50%;border:2px solid white;box-sizing:border-box;" +
        "overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.4);"
      const img = document.createElement("img")
      img.src = cluster.photos[0].objectUrl!
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;"
      circle.appendChild(img)
      el.appendChild(circle)

      if (cluster.photos.length > 1) {
        const badge = document.createElement("div")
        badge.textContent = String(cluster.photos.length)
        badge.style.cssText =
          `position:absolute;left:${HALF - 6}px;top:${-HALF - 10}px;` +
          "background:#ff6b35;color:white;border-radius:50%;" +
          "width:16px;height:16px;font-size:9px;font-weight:bold;" +
          "display:flex;align-items:center;justify-content:center;pointer-events:none;"
        el.appendChild(badge)
      }

      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onPhotoSelectRef.current(cluster)
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map)
      photoMarkersRef.current.set(cluster.id, marker)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapStore.map) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: mapStore.initialCenter ?? [15, 50],
      zoom: mapStore.initialZoom ?? 5,
      minZoom: 5,
      pitch: 0,
      attributionControl: { compact: false },
      // preserveDrawingBuffer is required for map.getCanvas() capture in the share export
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapStore.map = map

    map.on("rotate", () => setBearing(map.getBearing()))
    map.on("pitch", () => setPitch(map.getPitch()))

    // Persist map position synchronously on every moveend.
    // localStorage writes are synchronous so there's no async/timer race on page unload.
    map.on("moveend", () => {
      const c = map.getCenter()
      saveMapPosition([c.lng, c.lat], map.getZoom())
    })

    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["tracks-layer"],
      })
      if (features.length > 0) {
        onTrackSelectRef.current?.(features[0].properties?.id ?? null)
      }
    })

    map.once("load", () => {
      map.resize()
      setupMapLayers(map, "flat")
      mapStore.sourcesReady = true
      onMapReady?.()
    })

    map.on("zoomend", () => rebuildPhotoMarkers())

    return () => {
      mapStore.sourcesReady = false
      mapStore.map = null
      photoMarkersRef.current.forEach((m) => m.remove())
      photoMarkersRef.current.clear()
      map.remove()
    }
  }, [])

  useEffect(() => {
    if (!mapStore.worker) return

    mapStore.worker.onmessage = (e: MessageEvent<WorkerOutboundMessage>) => {
      const msg = e.data
      const map = mapStore.map

      // DONE: always notify the UI so the spinner and track count are updated
      // even if map sources are temporarily unavailable (e.g. during a style switch).
      // fitBounds is handled in handleProcessingUpdate (home.tsx) — it only needs the
      // map object, not sourcesReady.
      if (msg.type === "DONE") {
        onProcessingUpdateRef.current?.(msg.processedCount, true)

        // Persist the computed fog cache (requires live sources)
        if (
          map &&
          mapStore.sourcesReady &&
          mapStore.tracks.length > 0 &&
          mapStore.fogData
        ) {
          saveFogCache({
            trackIds: mapStore.tracks.map((t) => t.id).sort(),
            fogMode: mapStore.fogMode,
            fogData: mapStore.fogData,
          })
        }

        // Reset after onProcessingUpdateRef so home.tsx can read the flag before it clears
        mapStore.isRestoreReprocess = false
        return
      }

      // FOG_UPDATE: needs live sources to push data into the map
      if (!map || !mapStore.sourcesReady) return

      if (msg.type === "FOG_UPDATE") {
        mapStore.fogData = msg.fogData
        const fogSource = map.getSource(
          "fog-source"
        ) as maplibregl.GeoJSONSource
        fogSource?.setData(msg.fogData)

        // Only rebuild and re-push tracks when the list has changed.
        // mapStore.tracks is frozen during a processing run, so this fires at most
        // once per add/delete — not on every 300ms FOG_UPDATE.
        if (mapStore.tracks.length !== cachedTracksLength.current || !cachedTracksGeoJSON.current) {
          const trackFeatures = mapStore.tracks.map((t) =>
            lineString(t.coordinates, { name: t.name, id: t.id })
          )
          cachedTracksGeoJSON.current = featureCollection(trackFeatures)
          cachedTracksLength.current = mapStore.tracks.length
          const tracksSource = map.getSource(
            "tracks-source"
          ) as maplibregl.GeoJSONSource
          tracksSource?.setData(cachedTracksGeoJSON.current)
        }

        onProcessingUpdateRef.current?.(msg.processedCount, false)
      }
    }
  }, [])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return

    if (pendingStyleLoadRef.current) {
      map.off("styledata", pendingStyleLoadRef.current)
      pendingStyleLoadRef.current = null
    }

    mapStore.sourcesReady = false
    map.setStyle(mapMode === "relief" ? SATELLITE_STYLE : MAP_STYLE_URL)

    const onStyleData = () => {
      map.off("styledata", onStyleData)
      pendingStyleLoadRef.current = null

      setupMapLayers(map, mapMode)

      // Invalidate tracks cache so FOG_UPDATE re-pushes to the new source.
      cachedTracksGeoJSON.current = null
      cachedTracksLength.current = -1

      map.setLayoutProperty(
        "tracks-layer",
        "visibility",
        showTracksRef.current ? "visible" : "none"
      )

      if (mapMode !== "relief") {
        map.setLayoutProperty(
          "fog-layer",
          "visibility",
          showFogRef.current ? "visible" : "none"
        )
      }

      const sids = selectedTrackIdsRef.current
      if (sids.length > 0) {
        const selectionExpr = ["in", ["get", "id"], ["literal", sids]]
        map.setPaintProperty("tracks-layer", "line-width", [
          "case",
          selectionExpr,
          TRACK_WIDTH_SELECTED,
          TRACK_WIDTH_DEFAULT,
        ])
        map.setPaintProperty("tracks-layer", "line-opacity", [
          "case",
          selectionExpr,
          TRACK_OPACITY_SELECTED,
          TRACK_OPACITY_DIM,
        ])
      }

      map.easeTo({ pitch: mapMode === "relief" ? 45 : 0, duration: 400 })
      mapStore.sourcesReady = true
      rebuildPhotoMarkers()
    }

    pendingStyleLoadRef.current = onStyleData
    map.on("styledata", onStyleData)
  }, [mapMode])

  useEffect(() => {
    if (!mapStore.sourcesReady) return
    mapStore.map?.setLayoutProperty(
      "tracks-layer",
      "visibility",
      showTracks ? "visible" : "none"
    )
  }, [showTracks])

  useEffect(() => {
    if (!mapStore.sourcesReady) return
    mapStore.map?.setLayoutProperty(
      "fog-layer",
      "visibility",
      showFog ? "visible" : "none"
    )
  }, [showFog])

  useEffect(() => {
    if (!mapStore.sourcesReady || !mapStore.map) return
    const map = mapStore.map
    if (selectedTrackIds.length === 0) {
      map.setPaintProperty("tracks-layer", "line-width", TRACK_WIDTH_DEFAULT)
      map.setPaintProperty(
        "tracks-layer",
        "line-opacity",
        TRACK_OPACITY_DEFAULT
      )
      return
    }
    const selectionExpr = ["in", ["get", "id"], ["literal", selectedTrackIds]]
    map.setPaintProperty("tracks-layer", "line-width", [
      "case",
      selectionExpr,
      TRACK_WIDTH_SELECTED,
      TRACK_WIDTH_DEFAULT,
    ])
    map.setPaintProperty("tracks-layer", "line-opacity", [
      "case",
      selectionExpr,
      TRACK_OPACITY_SELECTED,
      TRACK_OPACITY_DIM,
    ])
  }, [selectedTrackIds])

  useEffect(() => {
    clusterCacheRef.current.clear()
    rebuildPhotoMarkers()
  }, [photos, showPhotos, rebuildPhotoMarkers])

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 h-screen" />
      <MapCompass
        bearing={bearing}
        pitch={pitch}
        onReset={() =>
          mapStore.map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })
        }
        className="absolute top-1.5 right-1.5 z-10 sm:top-3 sm:right-3"
      />
    </>
  )
}
