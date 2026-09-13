import { describe, expect, test } from "bun:test"
import { MAP_LAYER_IDS, MAP_SOURCE_IDS, setupMapLayers } from "~/lib/map/layers"
import { SAVED_POINT_COLORS } from "~shared/saved-points"

function createFakeMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, unknown>()
  const images = new Map<string, unknown>()
  const addedImages: string[] = []

  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => sources.set(id, source),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, image: unknown) => {
      images.set(id, image)
      addedImages.push(id)
      return map
    },
  }

  return { map, sources, layers, images, addedImages }
}

describe("saved-point map layers", () => {
  test("uses one shared atomic marker and one sorted hit layer", () => {
    const fake = createFakeMap()

    setupMapLayers(fake.map as never, "flat")

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

    setupMapLayers(fake.map as never, "flat")
    const sourceCount = fake.sources.size
    const layerCount = fake.layers.size
    const imageCount = fake.images.size
    const imageAdditionCount = fake.addedImages.length

    setupMapLayers(fake.map as never, "flat")

    expect(fake.sources.size).toBe(sourceCount)
    expect(fake.layers.size).toBe(layerCount)
    expect(fake.images.size).toBe(imageCount)
    expect(fake.addedImages).toHaveLength(imageAdditionCount)
  })
})
