import { describe, expect, test } from "bun:test"
import { MAP_LAYER_IDS, MAP_SOURCE_IDS, setupMapLayers } from "~/lib/map/layers"
import { ensureTrailLayers, removeTrailLayers } from "~/lib/map/trails/layers"
import {
  ORDERED_TRAIL_LAYER_IDS,
  ORDERED_TRAIL_SOURCE_IDS,
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_DASH_ARRAY,
  TRAIL_DATA_ZOOM,
  TRAIL_HIKING_CASING_WIDTH_DELTA,
  TRAIL_HIKING_WIDTH_STOPS,
  TRAIL_LAYER_IDS,
  TRAIL_MAX_RENDER_ZOOM,
  TRAIL_MIN_RENDER_ZOOM,
  TRAIL_SOURCE_IDS,
  TRAIL_SOURCE_LAYER,
} from "~/constants/trails"
import { SAVED_POINT_COLORS } from "~shared/saved-points"

function createFakeMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, unknown>()
  const images = new Map<string, unknown>()
  const addedImages: string[] = []
  const layerOrder: string[] = []
  const layerAddCalls: [string, string | undefined][] = []
  const layerRemoveCalls: string[] = []
  const sourceRemoveCalls: string[] = []

  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => sources.set(id, source),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }, beforeId?: string) => {
      layers.set(layer.id, layer)
      const index = beforeId ? layerOrder.indexOf(beforeId) : -1
      if (index >= 0) layerOrder.splice(index, 0, layer.id)
      else layerOrder.push(layer.id)
      layerAddCalls.push([layer.id, beforeId])
      return map
    },
    removeLayer: (id: string) => {
      layers.delete(id)
      const index = layerOrder.indexOf(id)
      if (index >= 0) layerOrder.splice(index, 1)
      layerRemoveCalls.push(id)
    },
    removeSource: (id: string) => {
      sources.delete(id)
      sourceRemoveCalls.push(id)
    },
    setTerrain: () => map,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, image: unknown) => {
      images.set(id, image)
      addedImages.push(id)
      return map
    },
  }

  return {
    map,
    sources,
    layers,
    images,
    addedImages,
    layerOrder,
    layerAddCalls,
    layerRemoveCalls,
    sourceRemoveCalls,
  }
}

describe("saved-point map layers", () => {
  test("uses one shared atomic marker and one sorted hit layer", () => {
    const fake = createFakeMap()

    setupMapLayers(fake.map as never, "flat", { showTrails: false })

    const markerLayer = fake.layers.get(MAP_LAYER_IDS.savedPointMarker) as {
      type: string
      layout: Record<string, unknown>
    }
    const hitLayer = fake.layers.get(MAP_LAYER_IDS.savedPointHit) as {
      type: string
      layout: Record<string, unknown>
      paint: Record<string, unknown>
    }

    expect(fake.sources.has(MAP_SOURCE_IDS.savedPoints)).toBe(true)
    expect(markerLayer.type).toBe("symbol")
    expect(markerLayer.layout).toMatchObject({
      "icon-image": ["get", "markerImage"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-pitch-alignment": "viewport",
      "icon-rotation-alignment": "viewport",
      "symbol-sort-key": ["get", "stackOrder"],
      "symbol-z-order": "source",
    })
    expect(hitLayer).toMatchObject({
      type: "circle",
      layout: { "circle-sort-key": ["get", "stackOrder"] },
      paint: {
        "circle-radius": 22,
        "circle-color": "#000",
        "circle-opacity": 0,
      },
    })
    expect(
      [...fake.layers.keys()].filter((id) => id.includes("saved-points"))
    ).toEqual([MAP_LAYER_IDS.savedPointMarker, MAP_LAYER_IDS.savedPointHit])
    expect(fake.images).toHaveLength(Object.keys(SAVED_POINT_COLORS).length)
  })

  test("does not duplicate shared resources when setup is repeated", () => {
    const fake = createFakeMap()

    setupMapLayers(fake.map as never, "flat", { showTrails: false })
    const sourceCount = fake.sources.size
    const layerCount = fake.layers.size
    const imageCount = fake.images.size
    const imageAdditionCount = fake.addedImages.length

    setupMapLayers(fake.map as never, "flat", { showTrails: false })

    expect(fake.sources.size).toBe(sourceCount)
    expect(fake.layers.size).toBe(layerCount)
    expect(fake.images.size).toBe(imageCount)
    expect(fake.addedImages).toHaveLength(imageAdditionCount)
  })

  test("adds trail sources and layers in order with configured styles", () => {
    const fake = createFakeMap()
    fake.map.addLayer({ id: MAP_LAYER_IDS.fog })
    fake.map.addLayer({ id: MAP_LAYER_IDS.activities })

    ensureTrailLayers(fake.map as never)

    expect(fake.layerOrder).toEqual([
      ...ORDERED_TRAIL_LAYER_IDS,
      MAP_LAYER_IDS.fog,
      MAP_LAYER_IDS.activities,
    ])
    expect(fake.layerAddCalls.slice(-3)).toEqual([
      [TRAIL_LAYER_IDS.hikingCasing, MAP_LAYER_IDS.fog],
      [TRAIL_LAYER_IDS.hiking, MAP_LAYER_IDS.fog],
      [TRAIL_LAYER_IDS.cycling, MAP_LAYER_IDS.fog],
    ])
    expect(fake.sources.get(TRAIL_SOURCE_IDS.hiking)).toEqual({
      type: "vector",
      tiles: ["fow-trails://hiking/{z}/{x}/{y}"],
      minzoom: TRAIL_DATA_ZOOM,
      maxzoom: TRAIL_DATA_ZOOM,
      attribution: expect.any(String),
    })

    const casing = fake.layers.get(TRAIL_LAYER_IDS.hikingCasing) as {
      minzoom: number
      maxzoom: number
      source: string
      "source-layer": string
      filter: unknown
      layout: Record<string, unknown>
      paint: Record<string, unknown>
    }
    const hiking = fake.layers.get(TRAIL_LAYER_IDS.hiking) as {
      paint: Record<string, unknown>
    }
    const cycling = fake.layers.get(TRAIL_LAYER_IDS.cycling) as {
      source: string
      "source-layer": string
      minzoom: number
      maxzoom: number
      layout: Record<string, unknown>
      paint: Record<string, unknown>
    }
    expect(casing).toMatchObject({
      source: TRAIL_SOURCE_IDS.hiking,
      "source-layer": TRAIL_SOURCE_LAYER,
      minzoom: TRAIL_MIN_RENDER_ZOOM,
      maxzoom: TRAIL_MAX_RENDER_ZOOM,
      layout: { "line-sort-key": ["get", "sort"] },
    })
    expect(casing.paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      ...TRAIL_HIKING_WIDTH_STOPS.flatMap((value, index) =>
        index % 2 === 0 ? [value] : [value + TRAIL_HIKING_CASING_WIDTH_DELTA]
      ),
    ])
    expect(hiking.paint["line-color"]).toEqual(["get", "color"])
    expect(cycling).toMatchObject({
      source: TRAIL_SOURCE_IDS.cycling,
      "source-layer": TRAIL_SOURCE_LAYER,
      minzoom: TRAIL_MIN_RENDER_ZOOM,
      maxzoom: TRAIL_MAX_RENDER_ZOOM,
      paint: {
        "line-color": TRAIL_CYCLING_COLOR,
        "line-dasharray": ["literal", TRAIL_CYCLING_DASH_ARRAY],
      },
    })
    expect(cycling.layout["line-sort-key"]).toEqual(["get", "sort"])
    expect(fake.layers.has("trails-cycling-casing-layer")).toBe(false)
  })

  test("repeated trail setup is idempotent and removes layers before sources", () => {
    const fake = createFakeMap()

    ensureTrailLayers(fake.map as never)
    const sourceCount = fake.sources.size
    const layerCount = fake.layers.size
    const addCount = fake.layerAddCalls.length
    ensureTrailLayers(fake.map as never)

    expect(fake.sources).toHaveLength(sourceCount)
    expect(fake.layers).toHaveLength(layerCount)
    expect(fake.layerAddCalls).toHaveLength(addCount)

    removeTrailLayers(fake.map as never)
    expect(fake.layerRemoveCalls).toEqual([
      TRAIL_LAYER_IDS.cycling,
      TRAIL_LAYER_IDS.hiking,
      TRAIL_LAYER_IDS.hikingCasing,
    ])
    expect(fake.sourceRemoveCalls).toEqual([...ORDERED_TRAIL_SOURCE_IDS])
    expect(fake.sources.has(TRAIL_SOURCE_IDS.hiking)).toBe(false)
  })
})
