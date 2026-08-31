import { describe, expect, test } from "bun:test"
import type maplibregl from "maplibre-gl"
import { attachMapInteractions } from "~/components/map/mapInteractions"
import { MAP_LAYER_IDS } from "~/lib/map/layers"
import type { SavedPointTooltipState } from "~/components/map/useSavedPoints"

describe("saved point map interactions", () => {
  test("updates the tooltip when moving directly between saved points", () => {
    const handlers = new Map<string, (event: unknown) => void>()
    const canvas = {
      style: { cursor: "" },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    const map = {
      getCanvas: () => canvas,
      on: (
        event: string,
        layerOrHandler: string | (() => void),
        handler?: () => void
      ) => {
        if (typeof layerOrHandler === "string" && handler) {
          handlers.set(`${event}:${layerOrHandler}`, handler)
        }
      },
      off: () => {},
    } as unknown as maplibregl.Map
    const tooltips: Array<SavedPointTooltipState | null> = []

    attachMapInteractions(map, {
      isShowingSavedPoints: () => true,
      getSavedPoints: () => [],
      onActivitySelect: () => {},
      onSavedPointSelect: () => {},
      onSavedPointTooltipChange: (tooltip) => tooltips.push(tooltip),
    })

    const featureEvent = (id: string, name: string, coordinates: number[]) => ({
      features: [
        {
          properties: { id, name },
          geometry: { type: "Point", coordinates },
        },
      ],
    })
    handlers.get(`mouseenter:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("first", "First", [10, 20])
    )
    handlers.get(`mousemove:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("second", "Second", [11, 21])
    )
    handlers.get(`mousemove:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("second", "Second", [11, 21])
    )

    expect(tooltips).toEqual([
      { name: "First", lngLat: [10, 20] },
      { name: "Second", lngLat: [11, 21] },
    ])
  })
})
