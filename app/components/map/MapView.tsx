import "maplibre-gl/dist/maplibre-gl.css"
import type { MapMode, ActivityCoords } from "~/types/activities"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"
import { MapCompass } from "~/components/map/MapCompass"
import { useFogWorkerBridge } from "~/components/map/useFogWorkerBridge"
import { useMapLifecycle } from "~/components/map/useMapLifecycle"
import { useMapPresentation } from "~/components/map/useMapPresentation"
import { useMyLocationMarker } from "~/components/map/useMyLocationMarker"
import { usePhotoMarkers } from "~/components/map/usePhotoMarkers"
import { useSavedPoints } from "~/components/map/useSavedPoints"
import { type SavedPointCreateLocation } from "~/components/map/mapInteractions"

interface MapViewProps {
  onMapReady?: () => void
  onProcessingUpdate?: (count: number, done: boolean) => void
  showActivities: boolean
  showFog: boolean
  selectedActivityIds: string[]
  onActivitySelect: (id: string | null) => void
  mapMode: MapMode
  photos: PhotoEntry[]
  showPhotos: boolean
  onPhotoSelect: (group: PhotoGroup | null) => void
  showMyLocation: boolean
  /** Current geolocation as [lng, lat], or null while unavailable. */
  myLocation: [number, number] | null
  /** Geometry drawn on lap-layer. Null when the whole activity is shown. */
  highlightCoordinates: ActivityCoords | null
  /** Geometry the camera frames — the lap, or the whole activity on "All laps". */
  focusCoordinates: ActivityCoords | null
  /**
   * Identity of the current focus: "<activityId>#lap3", "<activityId>#all", or null.
   * The effect keys on this rather than on the coordinate arrays, whose
   * `slice()` returns a fresh array every render and would refit continuously.
   */
  focusKey: string | null
  savedPoints: SavedPoint[]
  showSavedPoints: boolean
  onSavedPointSelect: (id: string) => void
  onSavedPointCreate?: (location: SavedPointCreateLocation) => void
}

export function MapView({
  onMapReady,
  onProcessingUpdate,
  showActivities,
  showFog,
  selectedActivityIds,
  onActivitySelect,
  mapMode,
  photos,
  showPhotos,
  onPhotoSelect,
  showMyLocation,
  myLocation,
  highlightCoordinates,
  focusCoordinates,
  focusKey,
  savedPoints,
  showSavedPoints,
  onSavedPointSelect,
  onSavedPointCreate,
}: MapViewProps) {
  const setSavedPointTooltip = useSavedPoints(savedPoints, showSavedPoints)
  const { invalidateActivitiesCache } = useFogWorkerBridge(onProcessingUpdate)
  const { rebuildPhotoMarkers } = usePhotoMarkers(
    photos,
    showPhotos,
    onPhotoSelect
  )
  const { containerRef, bearing, zoomIn, zoomOut, resetOrientation } =
    useMapLifecycle({
      mapMode,
      showActivities,
      showFog,
      selectedActivityIds,
      highlightCoordinates,
      savedPoints,
      showSavedPoints,
      onMapReady,
      onActivitySelect,
      onSavedPointSelect,
      onSavedPointCreate,
      onSavedPointTooltipChange: setSavedPointTooltip,
      invalidateActivitiesCache,
      rebuildPhotoMarkers,
    })

  // Declared after map initialization so its first effect sees the live map.
  useMyLocationMarker(showMyLocation, myLocation)
  useMapPresentation({
    showActivities,
    showFog,
    selectedActivityIds,
    highlightCoordinates,
    focusCoordinates,
    focusKey,
  })

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 h-screen" />
      <MapCompass
        bearing={bearing}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={resetOrientation}
        className="absolute top-1.5 right-1.5 z-10 sm:top-3 sm:right-3"
      />
    </>
  )
}
