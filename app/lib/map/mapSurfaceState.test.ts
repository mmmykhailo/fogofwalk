import { describe, expect, test } from "bun:test"
import {
  createInitialMapSurfaceState,
  mapSurfaceReducer,
  type MapSurfaceState,
} from "~/lib/map/mapSurfaceState"

describe("map surface state", () => {
  test("keeps dismissAll referentially stable when every surface is closed", () => {
    const state = createInitialMapSurfaceState()
    expect(mapSurfaceReducer(state, { type: "dismissAll" })).toBe(state)
  })

  test("dismisses all surfaces in one transition", () => {
    const state = {
      ...createInitialMapSurfaceState(),
      selectedActivityIds: ["activity-1"],
      selectedLap: { activityId: "activity-1", number: 2 },
      pendingActivityId: "activity-2",
      selectedPhotoGroup: { id: "photo-group" } as never,
      editingSavedPointId: "point-1",
      newSavedPointCoordinate: [10, 20] as [number, number],
      viewingSavedPoint: { id: "point-2" } as never,
    }
    expect(mapSurfaceReducer(state, { type: "dismissAll" })).toEqual(
      createInitialMapSurfaceState()
    )
  })

  test("keeps unrelated surfaces when closing an activity", () => {
    const state = {
      ...createInitialMapSurfaceState(),
      selectedActivityIds: ["activity-1"],
      selectedLap: { activityId: "activity-1", number: 2 },
      selectedPhotoGroup: { id: "photo-group" } as never,
      editingSavedPointId: "point-1",
    }
    expect(mapSurfaceReducer(state, { type: "closeActivity" })).toEqual({
      ...state,
      selectedActivityIds: [],
      selectedLap: null,
      pendingActivityId: null,
    })
  })

  test("keeps targeted close actions referentially stable when closed", () => {
    const state = createInitialMapSurfaceState()
    expect(mapSurfaceReducer(state, { type: "closeActivity" })).toBe(state)
    expect(mapSurfaceReducer(state, { type: "closePhoto" })).toBe(state)
    expect(mapSurfaceReducer(state, { type: "closeSavedPoint" })).toBe(state)
  })

  test("uses pending selection for a second activity", () => {
    let state = createInitialMapSurfaceState()
    state = mapSurfaceReducer(state, {
      type: "toggleMapActivity",
      id: "activity-1",
    })
    state = mapSurfaceReducer(state, {
      type: "toggleMapActivity",
      id: "activity-2",
    })
    expect(state.selectedActivityIds).toEqual(["activity-1"])
    expect(state.pendingActivityId).toBe("activity-2")
    expect(
      mapSurfaceReducer(state, { type: "replaceWithPendingActivity" })
    ).toEqual({
      ...state,
      selectedActivityIds: ["activity-2"],
      selectedLap: null,
      pendingActivityId: null,
    })
  })

  test("keeps deep links exact and makes saved-point modes exclusive", () => {
    let state: MapSurfaceState = {
      ...createInitialMapSurfaceState(),
      selectedActivityIds: ["activity-1", "activity-2"],
      selectedLap: { activityId: "activity-1", number: 1 },
      pendingActivityId: "activity-3",
    }
    state = mapSurfaceReducer(state, {
      type: "openActivityDeepLink",
      id: "activity-4",
    })
    expect(state.selectedActivityIds).toEqual(["activity-4"])
    expect(state.selectedLap).toBeNull()
    expect(state.pendingActivityId).toBeNull()

    state = mapSurfaceReducer(state, {
      type: "editSavedPoint",
      id: "point-1",
    })
    state = mapSurfaceReducer(state, {
      type: "createSavedPoint",
      coordinate: [10, 20],
    })
    expect(state.editingSavedPointId).toBeNull()
    expect(state.newSavedPointCoordinate).toEqual([10, 20])
    expect(state.viewingSavedPoint).toBeNull()
  })
})
