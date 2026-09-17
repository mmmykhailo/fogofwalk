import { describe, expect, test } from "bun:test"
import { MAP_LAYER_IDS, MAP_SOURCE_IDS, setupMapLayers } from "~/lib/map/layers"
import { ensureTrailLayers, removeTrailLayers } from "~/lib/map/trails/layers"
import {
  ORDERED_TRAIL_LAYER_IDS,
  ORDERED_TRAIL_SOURCE_IDS,
  REVERSE_TRAIL_LAYER_IDS,
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_DASH_ARRAY,
  TRAIL_CYCLING_NETWORKS,
  TRAIL_CYCLING_OPACITY,
  TRAIL_CYCLING_WIDTH_STOPS,
  TRAIL_HIKING_CASING_COLOR,
  TRAIL_HIKING_CASING_OPACITY,
  TRAIL_HIKING_CASING_WIDTH_DELTA,
  TRAIL_HIKING_COLOR,
  TRAIL_HIKING_DASH_ARRAY,
  TRAIL_HIKING_OPACITY,
  TRAIL_HIKING_WIDTH_STOPS,
  TRAIL_LAYER_IDS,
  TRAIL_MAX_RENDER_ZOOM,
  TRAIL_MIN_RENDER_ZOOM,
  TRAIL_SOURCE_ID,
  TRAIL_SOURCE_LAYER,
  TRAIL_TILEJSON_URL,
  TRAIL_WALKING_NETWORKS,
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
  const controls = new Set<unknown>()
  const events: string[] = []

  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => {
      sources.set(id, source)
      events.push(`source:add:${id}`)
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }, beforeId?: string) => {
      layers.set(layer.id, layer)
      const index = beforeId ? layerOrder.indexOf(beforeId) : -1
      if (index >= 0) layerOrder.splice(index, 0, layer.id)
      else layerOrder.push(layer.id)
      layerAddCalls.push([layer.id, beforeId])
      events.push(`layer:add:${layer.id}`)
      return map
    },
    moveLayer: (id: string, beforeId?: string) => {
      const index = layerOrder.indexOf(id)
      if (index >= 0) layerOrder.splice(index, 1)
      const beforeIndex = beforeId ? layerOrder.indexOf(beforeId) : -1
      if (beforeIndex >= 0) layerOrder.splice(beforeIndex, 0, id)
      else layerOrder.push(id)
    },
    removeLayer: (id: string) => {
      layers.delete(id)
      const index = layerOrder.indexOf(id)
      if (index >= 0) layerOrder.splice(index, 1)
      layerRemoveCalls.push(id)
      events.push(`layer:remove:${id}`)
    },
    removeSource: (id: string) => {
      sources.delete(id)
      sourceRemoveCalls.push(id)
      events.push(`source:remove:${id}`)
    },
    addControl: (control: unknown) => {
      controls.add(control)
      events.push("control:add")
      return map
    },
    removeControl: (control: unknown) => {
      controls.delete(control)
      events.push("control:remove")
      return map
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
    controls,
    events,
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

  test("adds the hosted trail source, attribution, and layers in order", () => {
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
      [TRAIL_LAYER_IDS.cycling, MAP_LAYER_IDS.fog],
      [TRAIL_LAYER_IDS.hikingCasing, MAP_LAYER_IDS.fog],
      [TRAIL_LAYER_IDS.hiking, MAP_LAYER_IDS.fog],
    ])
    expect(fake.sources.get(TRAIL_SOURCE_ID)).toEqual({
      type: "vector",
      url: TRAIL_TILEJSON_URL,
      maxzoom: 15,
    })
    expect(fake.controls).toHaveLength(1)

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
      source: string
      "source-layer": string
      minzoom: number
      maxzoom: number
      filter: unknown
      paint: Record<string, unknown>
    }
    const hikingWidth = [
      "interpolate",
      ["linear"],
      ["zoom"],
      ...TRAIL_HIKING_WIDTH_STOPS,
    ]
    const cyclingWidth = [
      "interpolate",
      ["linear"],
      ["zoom"],
      ...TRAIL_CYCLING_WIDTH_STOPS,
    ]
    expect(hiking).toMatchObject({
      source: TRAIL_SOURCE_ID,
      "source-layer": TRAIL_SOURCE_LAYER,
      minzoom: TRAIL_MIN_RENDER_ZOOM,
      maxzoom: TRAIL_MAX_RENDER_ZOOM,
      filter: [
        "in",
        ["get", "walking_network"],
        ["literal", TRAIL_WALKING_NETWORKS],
      ],
      paint: {
        "line-color": TRAIL_HIKING_COLOR,
        "line-opacity": TRAIL_HIKING_OPACITY,
        "line-width": hikingWidth,
        "line-dasharray": ["literal", TRAIL_HIKING_DASH_ARRAY],
      },
    })
    expect(casing.paint).toMatchObject({
      "line-color": TRAIL_HIKING_CASING_COLOR,
      "line-opacity": TRAIL_HIKING_CASING_OPACITY,
    })
    const cycling = fake.layers.get(TRAIL_LAYER_IDS.cycling) as {
      source: string
      "source-layer": string
      minzoom: number
      maxzoom: number
      layout: Record<string, unknown>
      paint: Record<string, unknown>
    }
    expect(casing).toMatchObject({
      source: TRAIL_SOURCE_ID,
      "source-layer": TRAIL_SOURCE_LAYER,
      minzoom: TRAIL_MIN_RENDER_ZOOM,
      maxzoom: TRAIL_MAX_RENDER_ZOOM,
      filter: [
        "in",
        ["get", "walking_network"],
        ["literal", TRAIL_WALKING_NETWORKS],
      ],
    })
    expect(casing.paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      ...TRAIL_HIKING_WIDTH_STOPS.flatMap((value, index) =>
        index % 2 === 0 ? [value] : [value + TRAIL_HIKING_CASING_WIDTH_DELTA]
      ),
    ])
    expect(casing.paint["line-dasharray"]).toBeUndefined()
    expect(hiking.paint["line-color"]).toBe(TRAIL_HIKING_COLOR)
    expect(cycling).toMatchObject({
      source: TRAIL_SOURCE_ID,
      "source-layer": TRAIL_SOURCE_LAYER,
      minzoom: TRAIL_MIN_RENDER_ZOOM,
      maxzoom: TRAIL_MAX_RENDER_ZOOM,
      paint: {
        "line-color": TRAIL_CYCLING_COLOR,
        "line-opacity": TRAIL_CYCLING_OPACITY,
        "line-width": cyclingWidth,
        "line-dasharray": ["literal", TRAIL_CYCLING_DASH_ARRAY],
      },
      filter: [
        "in",
        ["get", "cycling_network"],
        ["literal", TRAIL_CYCLING_NETWORKS],
      ],
    })
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

    const eventCount = fake.events.length
    removeTrailLayers(fake.map as never)
    expect(fake.layerRemoveCalls).toEqual([...REVERSE_TRAIL_LAYER_IDS])
    expect(fake.sourceRemoveCalls).toEqual([...ORDERED_TRAIL_SOURCE_IDS])
    expect(fake.sources.has(TRAIL_SOURCE_ID)).toBe(false)
    expect(fake.controls).toHaveLength(0)
    expect(fake.events.slice(eventCount)).toEqual([
      ...REVERSE_TRAIL_LAYER_IDS.map((id) => `layer:remove:${id}`),
      `source:remove:${TRAIL_SOURCE_ID}`,
      "control:remove",
    ])
  })

  test("does not create trail resources when trails are disabled", () => {
    const fake = createFakeMap()

    setupMapLayers(fake.map as never, "flat", { showTrails: false })

    expect(fake.sources.has(TRAIL_SOURCE_ID)).toBe(false)
    expect(
      Object.values(TRAIL_LAYER_IDS).some((id) => fake.layers.has(id))
    ).toBe(false)
    expect(fake.controls).toHaveLength(0)
  })

  test("restores flat fog before existing activities and removes it in relief", () => {
    const fake = createFakeMap()
    fake.map.addLayer({ id: MAP_LAYER_IDS.activities })
    fake.map.addLayer({ id: MAP_LAYER_IDS.fog })

    setupMapLayers(fake.map as never, "flat", { showTrails: false })
    expect(fake.layerOrder.indexOf(MAP_LAYER_IDS.fog)).toBeLessThan(
      fake.layerOrder.indexOf(MAP_LAYER_IDS.activities)
    )

    setupMapLayers(fake.map as never, "relief", { showTrails: false })
    expect(fake.layers.has(MAP_LAYER_IDS.fog)).toBe(false)
  })
})
