import { useEffect, useRef } from "react"
import bbox from "@turf/bbox"
import { lineString } from "@turf/helpers"
import {
  applyActivitySelectionPaint,
  setActivitiesVisible,
  setFogVisible,
  setLapHighlightData,
} from "~/lib/map/commands"
import { mapStore } from "~/lib/mapStore"
import type { ActivityCoords } from "~/types/activities"

interface MapPresentationOptions {
  showActivities: boolean
  showFog: boolean
  selectedActivityIds: string[]
  highlightCoordinates: ActivityCoords | null
  focusCoordinates: ActivityCoords | null
  focusKey: string | null
}

export function useMapPresentation(options: MapPresentationOptions): void {
  const previousFocusKeyRef = useRef<string | null>(null)
  const focusCoordinatesRef = useRef(options.focusCoordinates)
  focusCoordinatesRef.current = options.focusCoordinates
  const highlightCoordinatesRef = useRef(options.highlightCoordinates)
  highlightCoordinatesRef.current = options.highlightCoordinates

  useEffect(() => {
    if (mapStore.map && mapStore.sourcesReady) {
      setActivitiesVisible(mapStore.map, options.showActivities)
    }
  }, [options.showActivities])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return

    const previousFocusKey = previousFocusKeyRef.current
    previousFocusKeyRef.current = options.focusKey
    setLapHighlightData(map, highlightCoordinatesRef.current)

    const activityIdOf = (key: string | null) => key?.split("#")[0] ?? null
    if (
      !previousFocusKey ||
      activityIdOf(previousFocusKey) !== activityIdOf(options.focusKey)
    )
      return

    const coordinates = focusCoordinatesRef.current
    if (!coordinates || coordinates.length < 2) return
    const [minLng, minLat, maxLng, maxLat] = bbox(lineString(coordinates))
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, maxZoom: 16 }
    )
  }, [options.focusKey])

  useEffect(() => {
    if (mapStore.map && mapStore.sourcesReady) {
      setFogVisible(mapStore.map, options.showFog)
    }
  }, [options.showFog])

  const isLapActive = options.highlightCoordinates != null
  useEffect(() => {
    if (mapStore.map && mapStore.sourcesReady) {
      applyActivitySelectionPaint(
        mapStore.map,
        options.selectedActivityIds,
        isLapActive
      )
    }
  }, [options.selectedActivityIds, isLapActive])
}
