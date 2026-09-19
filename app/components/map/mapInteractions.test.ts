import { describe, expect, test } from "bun:test"
import type maplibregl from "maplibre-gl"
import {
  INTERACTIVE_TARGET_LAYER_IDS,
  MAP_INTERACTIVE_SELECTOR,
} from "~/components/map/interactiveTargets"
import { attachMapInteractions } from "~/components/map/mapInteractions"
import { MAP_LAYER_IDS } from "~/lib/map/layers"
import type { SavedPointTooltipState } from "~/components/map/useSavedPoints"

type Handler = (event: unknown) => void

interface FakeMapState {
  map: maplibregl.Map
  handlers: Map<string, Handler>
  canvasHandlers: Map<string, Handler>
  layers: Set<string>
  features: Map<string, maplibregl.MapGeoJSONFeature[]>
  queryCalls: string[][]
  easeToCalls: unknown[]
  setFeatures: (
    layerId: string,
    features: maplibregl.MapGeoJSONFeature[]
  ) => void
  fire: (eventName: string, event: unknown) => void
  fireCanvas: (eventName: string, event: unknown) => void
}

function createFeature(
  layerId: string,
  properties: Record<string, unknown> = {}
): maplibregl.MapGeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10, 20] },
    properties,
    layer: {
      id: layerId,
      type: layerId === MAP_LAYER_IDS.activityHit ? "line" : "circle",
      source: "test-source",
    },
    source: "test-source",
    state: {},
  } as maplibregl.MapGeoJSONFeature
}

function createFakeMap(
  layerIds: readonly string[] = [
    ...INTERACTIVE_TARGET_LAYER_IDS,
    MAP_LAYER_IDS.fog,
  ]
): FakeMapState {
  const handlers = new Map<string, Handler>()
  const canvasHandlers = new Map<string, Handler>()
  const layers = new Set(layerIds)
  const features = new Map<string, maplibregl.MapGeoJSONFeature[]>()
  const queryCalls: string[][] = []
  const easeToCalls: unknown[] = []
  const canvas = {
    style: { cursor: "" },
    addEventListener: (eventName: string, handler: EventListener) =>
      canvasHandlers.set(eventName, handler as Handler),
    removeEventListener: (eventName: string) =>
      canvasHandlers.delete(eventName),
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect,
  }
  const map = {
    getCanvas: () => canvas,
    getLayer: (layerId: string) =>
      layers.has(layerId) ? { id: layerId } : undefined,
    queryRenderedFeatures: (
      _point: unknown,
      options?: { layers?: readonly string[] }
    ) => {
      const queriedLayers = [...(options?.layers ?? [])]
      queryCalls.push(queriedLayers)
      return queriedLayers.flatMap((layerId) => features.get(layerId) ?? [])
    },
    getZoom: () => 8,
    easeTo: (options: unknown) => easeToCalls.push(options),
    unproject: () => ({ lng: 10, lat: 20 }),
    on: (
      eventName: string,
      layerOrHandler: string | Handler,
      handler?: Handler
    ) => {
      if (typeof layerOrHandler === "string") {
        if (handler) handlers.set(`${eventName}:${layerOrHandler}`, handler)
      } else {
        handlers.set(eventName, layerOrHandler)
      }
    },
    off: () => {},
  } as unknown as maplibregl.Map

  return {
    map,
    handlers,
    canvasHandlers,
    layers,
    features,
    queryCalls,
    easeToCalls,
    setFeatures: (layerId, nextFeatures) => features.set(layerId, nextFeatures),
    fire: (eventName, event) => handlers.get(eventName)?.(event),
    fireCanvas: (eventName, event) => canvasHandlers.get(eventName)?.(event),
  }
}

function mapEvent(
  target: EventTarget | { closest?: unknown } | null = null,
  point = { x: 10, y: 10 }
): maplibregl.MapMouseEvent {
  return {
    point,
    lngLat: { lng: 10, lat: 20 },
    originalEvent: { target } as unknown as MouseEvent,
    preventDefault: () => {},
  } as unknown as maplibregl.MapMouseEvent
}

function attachForTest(
  state: FakeMapState,
  overrides: {
    interactiveTargetLayerIds?: readonly string[]
    isShowingSavedPoints?: () => boolean
  } = {}
) {
  const activities: Array<string | null> = []
  const savedPointSelections: string[] = []
  const savedPointCreates: unknown[] = []
  const backgroundClicks: number[] = []
  const tooltips: Array<SavedPointTooltipState | null> = []

  const detach = attachMapInteractions(state.map, {
    isShowingSavedPoints: overrides.isShowingSavedPoints ?? (() => true),
    getSavedPoints: () => [
      {
        id: "point-1",
        lng: 10,
        lat: 20,
        name: "Point 1",
        description: null,
        color: "blue",
        isPublic: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    onActivitySelect: (id) => activities.push(id),
    onSavedPointSelect: (id) => savedPointSelections.push(id),
    onSavedPointCreate: (location) => savedPointCreates.push(location),
    onSavedPointTooltipChange: (tooltip) => tooltips.push(tooltip),
    onMapBackgroundClick: () => backgroundClicks.push(1),
    interactiveTargetLayerIds: overrides.interactiveTargetLayerIds,
  })

  return {
    detach,
    activities,
    savedPointSelections,
    savedPointCreates,
    backgroundClicks,
    tooltips,
  }
}

describe("map interactive targets", () => {
  test("updates the tooltip when moving directly between saved points", () => {
    const state = createFakeMap()
    const { detach, tooltips } = attachForTest(state)

    const featureEvent = (id: string, name: string, coordinates: number[]) => ({
      features: [
        {
          properties: { id, name },
          geometry: { type: "Point", coordinates },
        },
      ],
    })
    state.handlers.get(`mouseenter:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("first", "First", [10, 20])
    )
    state.handlers.get(`mousemove:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("second", "Second", [11, 21])
    )
    state.handlers.get(`mousemove:${MAP_LAYER_IDS.savedPointHit}`)?.(
      featureEvent("second", "Second", [11, 21])
    )

    expect(tooltips).toEqual([
      { name: "First", lngLat: [10, 20] },
      { name: "Second", lngLat: [11, 21] },
    ])
    detach()
  })

  test("dismisses an empty click when fog is present", () => {
    const state = createFakeMap()
    const { detach, activities, backgroundClicks } = attachForTest(state)

    state.fire("click", mapEvent())

    expect(backgroundClicks).toHaveLength(1)
    expect(activities).toEqual([])
    expect(state.queryCalls).toEqual([[...INTERACTIVE_TARGET_LAYER_IDS]])
    detach()
  })

  test("dismisses an empty click when fog is absent", () => {
    const state = createFakeMap(INTERACTIVE_TARGET_LAYER_IDS)
    const { detach, backgroundClicks } = attachForTest(state)

    state.fire("click", mapEvent())

    expect(backgroundClicks).toHaveLength(1)
    detach()
  })

  test("selects an activity route without background dismissal", () => {
    const state = createFakeMap()
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit, { id: "activity-1" }),
    ])
    const { detach, activities, backgroundClicks } = attachForTest(state)

    state.fire("click", mapEvent())

    expect(activities).toEqual(["activity-1"])
    expect(backgroundClicks).toEqual([])
    detach()
  })

  test("keeps saved-point priority over an overlapping activity route", () => {
    const state = createFakeMap()
    state.setFeatures(MAP_LAYER_IDS.savedPointHit, [
      createFeature(MAP_LAYER_IDS.savedPointHit, { id: "point-1" }),
    ])
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit, { id: "activity-1" }),
    ])
    const { detach, activities, savedPointSelections, backgroundClicks } =
      attachForTest(state)

    state.fire("click", mapEvent())

    expect(savedPointSelections).toEqual(["point-1"])
    expect(activities).toEqual([])
    expect(backgroundClicks).toEqual([])
    expect(state.easeToCalls).toEqual([{ center: [10, 20], zoom: 10 }])
    detach()
  })

  test("protects a generic registered overlay without a selection branch", () => {
    const syntheticLayerId = "synthetic-hit-layer"
    const registry = [...INTERACTIVE_TARGET_LAYER_IDS, syntheticLayerId]
    const state = createFakeMap(registry)
    state.setFeatures(syntheticLayerId, [createFeature(syntheticLayerId)])
    const { detach, backgroundClicks } = attachForTest(state, {
      interactiveTargetLayerIds: registry,
    })

    state.fire("click", mapEvent())

    expect(backgroundClicks).toEqual([])
    detach()
  })

  test("filters missing registered layers during a style replacement", () => {
    const state = createFakeMap([MAP_LAYER_IDS.fog])
    const { detach, backgroundClicks } = attachForTest(state)

    state.fire("click", mapEvent())

    expect(backgroundClicks).toHaveLength(1)
    expect(state.queryCalls).toEqual([])
    detach()
  })

  test("creates a saved point over an activity hitbox", () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fire("contextmenu", mapEvent())

    expect(savedPointCreates).toEqual([
      { lng: 10, lat: 20, point: { x: 10, y: 10 } },
    ])
    detach()
  })

  test("keeps a visible saved-point hit protected over an activity", () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.savedPointHit, [
      createFeature(MAP_LAYER_IDS.savedPointHit),
    ])
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fire("contextmenu", mapEvent())

    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("does not let hidden saved-point hits block creation", () => {
    const state = createFakeMap()
    state.setFeatures(MAP_LAYER_IDS.savedPointHit, [
      createFeature(MAP_LAYER_IDS.savedPointHit),
    ])
    const { detach, savedPointCreates } = attachForTest(state, {
      isShowingSavedPoints: () => false,
    })

    state.fire("contextmenu", mapEvent())

    expect(savedPointCreates).toHaveLength(1)
    detach()
  })

  test("protects a generic registered overlay from create gestures", () => {
    const syntheticLayerId = "synthetic-hit-layer"
    const registry = [...INTERACTIVE_TARGET_LAYER_IDS, syntheticLayerId]
    const state = createFakeMap(registry)
    state.setFeatures(syntheticLayerId, [createFeature(syntheticLayerId)])
    const { detach, savedPointCreates } = attachForTest(state, {
      interactiveTargetLayerIds: registry,
    })

    state.fire("contextmenu", mapEvent())

    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("protects DOM-backed markers from create gestures", () => {
    const state = createFakeMap()
    const markerTarget = {
      closest: (selector: string) =>
        selector === MAP_INTERACTIVE_SELECTOR ? {} : null,
    }
    const { detach, savedPointCreates } = attachForTest(state)

    state.fire("contextmenu", mapEvent(markerTarget))

    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("creates a saved point on an empty-map context menu", () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)

    state.fire("contextmenu", mapEvent())

    expect(savedPointCreates).toEqual([
      { lng: 10, lat: 20, point: { x: 10, y: 10 } },
    ])
    detach()
  })

  test("creates a saved point on an activity hitbox after a touch long-press", async () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 550))

    expect(savedPointCreates).toEqual([
      { lng: 10, lat: 20, point: { x: 10, y: 10 } },
    ])
    detach()
  })

  test("protects saved points and DOM-backed markers from touch long-press", async () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    const markerTarget = {
      closest: (selector: string) =>
        selector === MAP_INTERACTIVE_SELECTOR ? {} : null,
    }
    state.setFeatures(MAP_LAYER_IDS.savedPointHit, [
      createFeature(MAP_LAYER_IDS.savedPointHit),
    ])

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 550))

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
      target: markerTarget,
    })
    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("cancels a touch long-press when the pointer moves", async () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    state.fireCanvas("pointermove", {
      pointerId: 1,
      clientX: 19,
      clientY: 10,
    })
    await new Promise((resolve) => setTimeout(resolve, 550))

    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("cancels a touch long-press when a secondary pointer appears", async () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: false,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 550))

    expect(savedPointCreates).toEqual([])
    detach()
  })

  test("cleans up a pending touch long-press", async () => {
    const state = createFakeMap()
    const { detach, savedPointCreates } = attachForTest(state)
    state.setFeatures(MAP_LAYER_IDS.activityHit, [
      createFeature(MAP_LAYER_IDS.activityHit),
    ])

    state.fireCanvas("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
    })
    detach()
    await new Promise((resolve) => setTimeout(resolve, 550))

    expect(savedPointCreates).toEqual([])
  })
})
