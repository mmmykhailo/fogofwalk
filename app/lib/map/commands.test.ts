import { describe, expect, test } from "bun:test"
import {
  applyActivitySelectionPaint,
  clearRenderedActivityState,
  rehydrateMapPresentation,
  setLapHighlightData,
} from "~/lib/map/commands"
import { mapStore } from "~/lib/mapStore"

describe("map rendering commands", () => {
  test("sets the default activity paint when nothing is selected", () => {
    const calls: unknown[][] = []
    const map = {
      setPaintProperty: (...args: unknown[]) => calls.push(args),
    }

    applyActivitySelectionPaint(map as never, [], false)

    expect(calls).toEqual([
      ["activities-layer", "line-width", 2],
      ["activities-layer", "line-opacity", 0.85],
      ["activities-layer", "line-color", "#ff6b35"],
    ])
  })

  test("lap updates safely no-op while the source is unavailable", () => {
    setLapHighlightData({ getSource: () => undefined } as never, [
      [14, 50],
      [15, 51],
    ])
  })

  test("sets an empty collection when clearing a lap", () => {
    let data: unknown
    const map = {
      getSource: () => ({ setData: (next: unknown) => (data = next) }),
    }

    setLapHighlightData(map as never, null)

    expect(data).toEqual({ type: "FeatureCollection", features: [] })
  })

  test("rehydrates a relief style without requiring a fog layer", () => {
    const layoutCalls: unknown[][] = []
    const paintCalls: unknown[][] = []
    const map = {
      getLayer: (id: string) => (id === "fog-layer" ? undefined : { id }),
      getSource: () => ({ setData: () => undefined }),
      setLayoutProperty: (...args: unknown[]) => layoutCalls.push(args),
      setPaintProperty: (...args: unknown[]) => paintCalls.push(args),
    }

    rehydrateMapPresentation(map as never, {
      showActivities: false,
      showFog: false,
      selectedActivityIds: [],
      highlightCoordinates: null,
      savedPoints: [],
      showSavedPoints: false,
    })

    expect(layoutCalls.some(([id]) => id === "fog-layer")).toBe(false)
    expect(
      layoutCalls.filter(([, property]) => property === "visibility")
    ).toHaveLength(6)
    expect(paintCalls).toHaveLength(3)
  })

  test("clears every activity-derived source behind one guarded command", () => {
    const previousMap = mapStore.map
    const previousSourcesReady = mapStore.sourcesReady
    const sourceData = new Map<string, unknown>()
    mapStore.map = {
      getSource: (id: string) => ({
        setData: (data: unknown) => sourceData.set(id, data),
      }),
    } as never
    mapStore.sourcesReady = true

    try {
      clearRenderedActivityState()
    } finally {
      mapStore.map = previousMap
      mapStore.sourcesReady = previousSourcesReady
    }

    expect(sourceData.get("activities-source")).toEqual({
      type: "FeatureCollection",
      features: [],
    })
    expect(sourceData.get("lap-source")).toEqual({
      type: "FeatureCollection",
      features: [],
    })
    expect(sourceData.has("fog-source")).toBe(true)
  })
})
