import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { createRoot } from "react-dom/client"
import maplibregl from "maplibre-gl"
import { SavedPointTooltip } from "~/components/SavedPointTooltip"
import { setSavedPointsPresentation } from "~/lib/map/commands"
import { mapStore } from "~/lib/mapStore"
import type { SavedPoint } from "~shared/saved-points"

export interface SavedPointTooltipState {
  name: string
  lngLat: [number, number]
}

export function useSavedPoints(
  savedPoints: SavedPoint[],
  showSavedPoints: boolean
): Dispatch<SetStateAction<SavedPointTooltipState | null>> {
  const [tooltip, setTooltip] = useState<SavedPointTooltipState | null>(null)

  useEffect(() => {
    if (!showSavedPoints) setTooltip(null)
  }, [showSavedPoints])

  // A DOM marker keeps the React tooltip anchored while the map moves.
  useEffect(() => {
    const map = mapStore.map
    if (!map || !tooltip) return

    const element = document.createElement("div")
    element.style.pointerEvents = "none"
    const root = createRoot(element)
    root.render(<SavedPointTooltip name={tooltip.name} />)

    const marker = new maplibregl.Marker({
      element,
      anchor: "bottom",
      offset: [0, -20],
    })
      .setLngLat(tooltip.lngLat)
      .addTo(map)

    return () => {
      marker.remove()
      // This cleanup runs while the parent root is committing. Defer disposal
      // of the nested root until React has finished that render.
      queueMicrotask(() => root.unmount())
    }
  }, [tooltip])

  useEffect(() => {
    const map = mapStore.map
    if (!map || !mapStore.sourcesReady) return
    setSavedPointsPresentation(map, savedPoints, showSavedPoints)
  }, [savedPoints, showSavedPoints])

  return setTooltip
}
