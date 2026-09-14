import { describe, expect, test } from "bun:test"
import {
  applyActivitySelectionPaint,
  applyFogDataToMap,
  clearRenderedActivityState,
  rehydrateMapPresentation,
  setLapHighlightData,
} from "~/lib/map/commands"
import { mapStore, worldFogGeoJSON } from "~/lib/mapStore"

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

  test("publishes a fog source revision only after sources are ready", () => {
    const previousSourcesReady = mapStore.sourcesReady
    const previousRevision = mapStore.renderSourceRevision
    mapStore.sourcesReady = false
    mapStore.renderSourceRevision = 8
    const calls: unknown[] = []
    const map = {
      getSource: () => ({ setData: (data: unknown) => calls.push(data) }),
    }

    try {
      expect(applyFogDataToMap(map as never, worldFogGeoJSON(), 3)).toBe(false)
      expect(calls).toHaveLength(0)

      mapStore.sourcesReady = true
      expect(applyFogDataToMap(map as never, worldFogGeoJSON(), 3)).toBe(true)
      expect(calls).toHaveLength(1)
      expect(mapStore.renderSourceRevision).toBe(3)
    } finally {
      mapStore.sourcesReady = previousSourcesReady
      mapStore.renderSourceRevision = previousRevision
    }
  })

  test("updates the implementation behind a custom fog layer", () => {
    const previousSourcesReady = mapStore.sourcesReady
    const previousRevision = mapStore.renderSourceRevision
    mapStore.sourcesReady = true
    mapStore.renderSourceRevision = null
    let data: unknown
    const map = {
      getLayer: () => ({
        implementation: {
          setData: (next: unknown) => (data = next),
        },
      }),
      getSource: () => undefined,
    }

    try {
      expect(applyFogDataToMap(map as never, worldFogGeoJSON(), 4)).toBe(true)
      expect(data).toEqual(worldFogGeoJSON())
      expect(mapStore.renderSourceRevision as unknown).toBe(4)
    } finally {
      mapStore.sourcesReady = previousSourcesReady
      mapStore.renderSourceRevision = previousRevision
    }
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
    ).toHaveLength(5)
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
