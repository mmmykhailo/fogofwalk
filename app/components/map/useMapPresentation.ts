import { useEffect, useRef } from "react"
import bbox from "@turf/bbox"
import { lineString, multiLineString } from "@turf/helpers"
import {
  applyActivitySelectionPaint,
  setActivitiesVisible,
  setFogVisible,
  setLapHighlightData,
  setTrailsEnabled,
} from "~/lib/map/commands"
import { mapStore } from "~/lib/mapStore"
import type { ActivityPaths } from "~/types/activities"

interface MapPresentationOptions {
  showActivities: boolean
  showTrails: boolean
  showFog: boolean
  selectedActivityIds: string[]
  highlightPaths: ActivityPaths | null
  focusPaths: ActivityPaths | null
  focusKey: string | null
}

export function useMapPresentation(options: MapPresentationOptions): void {
  const previousFocusKeyRef = useRef<string | null>(null)
  const focusPathsRef = useRef(options.focusPaths)
  focusPathsRef.current = options.focusPaths
  const highlightPathsRef = useRef(options.highlightPaths)
  highlightPathsRef.current = options.highlightPaths

  useEffect(() => {
    if (mapStore.map && mapStore.sourcesReady) {
      setActivitiesVisible(mapStore.map, options.showActivities)
    }
  }, [options.showActivities])

  useEffect(() => {
    if (mapStore.map && mapStore.sourcesReady) {
      setTrailsEnabled(mapStore.map, options.showTrails)
    }
  }, [options.showTrails])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return

    const previousFocusKey = previousFocusKeyRef.current
    previousFocusKeyRef.current = options.focusKey
    setLapHighlightData(map, highlightPathsRef.current)

    const activityIdOf = (key: string | null) => key?.split("#")[0] ?? null
    if (
      !previousFocusKey ||
      activityIdOf(previousFocusKey) !== activityIdOf(options.focusKey)
    )
      return

    const paths = focusPathsRef.current
    if (!paths || paths.every((path) => path.length < 2)) return
    const renderablePaths = paths.filter((path) => path.length >= 2)
    const geometry =
      renderablePaths.length === 1
        ? lineString(renderablePaths[0]!)
        : multiLineString(renderablePaths)
    const [minLng, minLat, maxLng, maxLat] = bbox(geometry)
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

  const isLapActive = options.highlightPaths != null
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
