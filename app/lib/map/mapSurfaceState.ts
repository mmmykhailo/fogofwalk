import type { PhotoGroup } from "~/types/photos"
import type { SavedPoint } from "~shared/saved-points"

export interface MapSurfaceState {
  selectedActivityIds: string[]
  selectedLap: { activityId: string; number: number } | null
  pendingActivityId: string | null
  selectedPhotoGroup: PhotoGroup | null
  editingSavedPointId: string | null
  newSavedPointCoordinate: [number, number] | null
  viewingSavedPoint: SavedPoint | null
}

export type MapSurfaceAction =
  | { type: "dismissAll" }
  | { type: "closeActivity" }
  | { type: "closePhoto" }
  | { type: "closeSavedPoint" }
  | { type: "toggleMapActivity"; id: string }
  | { type: "openActivityDeepLink"; id: string }
  | { type: "removeActivity"; id: string }
  | { type: "setLap"; number: number | null }
  | { type: "setPendingActivity"; id: string | null }
  | { type: "cancelPendingActivity" }
  | { type: "replaceWithPendingActivity" }
  | { type: "addPendingActivity" }
  | { type: "selectPhoto"; group: PhotoGroup }
  | { type: "editSavedPoint"; id: string }
  | { type: "createSavedPoint"; coordinate: [number, number] }
  | { type: "viewSavedPoint"; point: SavedPoint }

export function createInitialMapSurfaceState(): MapSurfaceState {
  return {
    selectedActivityIds: [],
    selectedLap: null,
    pendingActivityId: null,
    selectedPhotoGroup: null,
    editingSavedPointId: null,
    newSavedPointCoordinate: null,
    viewingSavedPoint: null,
  }
}

function sameCoordinate(
  first: [number, number] | null,
  second: [number, number] | null
): boolean {
  return (
    first === second ||
    (first != null &&
      second != null &&
      first[0] === second[0] &&
      first[1] === second[1])
  )
}

function withActivitySelection(
  state: MapSurfaceState,
  selectedActivityIds: string[],
  selectedLap: MapSurfaceState["selectedLap"],
  pendingActivityId: string | null
): MapSurfaceState {
  if (
    state.selectedActivityIds.length === selectedActivityIds.length &&
    state.selectedActivityIds.every(
      (id, index) => id === selectedActivityIds[index]
    ) &&
    state.selectedLap === selectedLap &&
    state.pendingActivityId === pendingActivityId
  ) {
    return state
  }
  return {
    ...state,
    selectedActivityIds,
    selectedLap,
    pendingActivityId,
  }
}

export function mapSurfaceReducer(
  state: MapSurfaceState,
  action: MapSurfaceAction
): MapSurfaceState {
  switch (action.type) {
    case "dismissAll": {
      if (
        state.selectedActivityIds.length === 0 &&
        state.selectedLap === null &&
        state.pendingActivityId === null &&
        state.selectedPhotoGroup === null &&
        state.editingSavedPointId === null &&
        state.newSavedPointCoordinate === null &&
        state.viewingSavedPoint === null
      ) {
        return state
      }
      return createInitialMapSurfaceState()
    }

    case "closeActivity":
      return withActivitySelection(state, [], null, null)

    case "closePhoto":
      return state.selectedPhotoGroup === null
        ? state
        : { ...state, selectedPhotoGroup: null }

    case "closeSavedPoint":
      if (
        state.editingSavedPointId === null &&
        state.newSavedPointCoordinate === null &&
        state.viewingSavedPoint === null
      ) {
        return state
      }
      return {
        ...state,
        editingSavedPointId: null,
        newSavedPointCoordinate: null,
        viewingSavedPoint: null,
      }

    case "toggleMapActivity": {
      const { id } = action
      if (state.selectedActivityIds.includes(id)) {
        return withActivitySelection(
          state,
          state.selectedActivityIds.filter((selectedId) => selectedId !== id),
          null,
          null
        )
      }
      if (state.selectedActivityIds.length === 0) {
        return withActivitySelection(state, [id], null, null)
      }
      return withActivitySelection(state, state.selectedActivityIds, null, id)
    }

    case "openActivityDeepLink":
      return withActivitySelection(state, [action.id], null, null)

    case "removeActivity": {
      if (!state.selectedActivityIds.includes(action.id)) return state
      const selectedActivityIds = state.selectedActivityIds.filter(
        (id) => id !== action.id
      )
      return withActivitySelection(
        state,
        selectedActivityIds,
        selectedActivityIds.length === 0 ? null : state.selectedLap,
        selectedActivityIds.length === 0 ? null : state.pendingActivityId
      )
    }

    case "setLap": {
      const nextLap =
        action.number != null && state.selectedActivityIds.length === 1
          ? { activityId: state.selectedActivityIds[0]!, number: action.number }
          : null
      return withActivitySelection(
        state,
        state.selectedActivityIds,
        nextLap,
        state.pendingActivityId
      )
    }

    case "setPendingActivity":
      return withActivitySelection(
        state,
        state.selectedActivityIds,
        state.selectedLap,
        action.id
      )

    case "cancelPendingActivity":
      return withActivitySelection(
        state,
        state.selectedActivityIds,
        state.selectedLap,
        null
      )

    case "replaceWithPendingActivity":
      if (state.pendingActivityId === null) return state
      return withActivitySelection(state, [state.pendingActivityId], null, null)

    case "addPendingActivity": {
      if (state.pendingActivityId === null) return state
      const selectedActivityIds = state.selectedActivityIds.includes(
        state.pendingActivityId
      )
        ? state.selectedActivityIds
        : [...state.selectedActivityIds, state.pendingActivityId]
      return withActivitySelection(state, selectedActivityIds, null, null)
    }

    case "selectPhoto":
      return state.selectedPhotoGroup === action.group
        ? state
        : { ...state, selectedPhotoGroup: action.group }

    case "editSavedPoint":
      if (
        state.editingSavedPointId === action.id &&
        state.newSavedPointCoordinate === null &&
        state.viewingSavedPoint === null
      ) {
        return state
      }
      return {
        ...state,
        editingSavedPointId: action.id,
        newSavedPointCoordinate: null,
        viewingSavedPoint: null,
      }

    case "createSavedPoint":
      if (
        state.editingSavedPointId === null &&
        sameCoordinate(state.newSavedPointCoordinate, action.coordinate) &&
        state.viewingSavedPoint === null
      ) {
        return state
      }
      return {
        ...state,
        editingSavedPointId: null,
        newSavedPointCoordinate: action.coordinate,
        viewingSavedPoint: null,
      }

    case "viewSavedPoint":
      if (
        state.viewingSavedPoint === action.point &&
        state.editingSavedPointId === null &&
        state.newSavedPointCoordinate === null
      ) {
        return state
      }
      return {
        ...state,
        editingSavedPointId: null,
        newSavedPointCoordinate: null,
        viewingSavedPoint: action.point,
      }
  }
}
