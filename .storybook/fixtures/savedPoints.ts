import type { SavedPoint, SavedPointColor } from "~shared/saved-points"

export const FIXTURE_SAVED_POINT_TIME_MS = Date.parse(
  "2026-09-15T07:00:00.000Z"
)

export function makeSavedPoint(
  overrides: Partial<SavedPoint> = {}
): SavedPoint {
  return {
    id: "saved-point-fixture-1",
    lng: 14.4211,
    lat: 50.0784,
    name: "River bend",
    description: "A quiet bend with a view of the old footbridge.",
    color: "teal",
    isPublic: false,
    createdAt: FIXTURE_SAVED_POINT_TIME_MS,
    updatedAt: FIXTURE_SAVED_POINT_TIME_MS,
    ...overrides,
  }
}

export function makeSavedPointsByColor(): Record<SavedPointColor, SavedPoint> {
  return {
    red: makeSavedPoint({ id: "saved-point-red", color: "red" }),
    orange: makeSavedPoint({ id: "saved-point-orange", color: "orange" }),
    amber: makeSavedPoint({ id: "saved-point-amber", color: "amber" }),
    green: makeSavedPoint({ id: "saved-point-green", color: "green" }),
    teal: makeSavedPoint({ id: "saved-point-teal", color: "teal" }),
    blue: makeSavedPoint({ id: "saved-point-blue", color: "blue" }),
    purple: makeSavedPoint({ id: "saved-point-purple", color: "purple" }),
    pink: makeSavedPoint({ id: "saved-point-pink", color: "pink" }),
  }
}
