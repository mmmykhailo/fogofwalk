import { describe, expect, test } from "bun:test"

import {
  SAVED_POINT_DESCRIPTION_MAX_LENGTH,
  SAVED_POINT_NAME_MAX_LENGTH,
  isSavedPointColor,
  isValidSavedPointCoordinate,
  isValidSavedPointInput,
  normalizeSavedPointInput,
  type SavedPointInput,
} from "./saved-points"

const point: SavedPointInput = {
  id: "9b57f112-e3c7-44e7-a79a-8b4ec1a028af",
  lng: 14.4378,
  lat: 50.0755,
  name: "Charles Bridge",
  description: null,
  color: "blue",
  isPublic: false,
}

describe("saved-point shared validation", () => {
  test("normalizes text without silently truncating it", () => {
    expect(
      normalizeSavedPointInput({
        ...point,
        name: "  Charles Bridge  ",
        description: "  A good place to watch the sunrise.  ",
      })
    ).toEqual({
      ...point,
      name: "Charles Bridge",
      description: "A good place to watch the sunrise.",
    })

    expect(
      normalizeSavedPointInput({ ...point, description: " \n\t " }).description
    ).toBeNull()
    expect(
      normalizeSavedPointInput({
        ...point,
        name: "x".repeat(SAVED_POINT_NAME_MAX_LENGTH + 1),
      }).name
    ).toHaveLength(SAVED_POINT_NAME_MAX_LENGTH + 1)
  })

  test("enforces Unicode text boundaries after trimming", () => {
    expect(
      isValidSavedPointInput({
        ...point,
        name: "🙂".repeat(SAVED_POINT_NAME_MAX_LENGTH),
        description: "🙂".repeat(SAVED_POINT_DESCRIPTION_MAX_LENGTH),
      })
    ).toBe(true)
    expect(
      isValidSavedPointInput({
        ...point,
        name: "🙂".repeat(SAVED_POINT_NAME_MAX_LENGTH + 1),
      })
    ).toBe(false)
    expect(
      isValidSavedPointInput({
        ...point,
        name: "   ",
      })
    ).toBe(false)
    expect(
      isValidSavedPointInput({
        ...point,
        description: "x".repeat(SAVED_POINT_DESCRIPTION_MAX_LENGTH + 1),
      })
    ).toBe(false)
  })

  test("accepts only palette keys and finite WGS84 coordinates", () => {
    expect(isSavedPointColor("purple")).toBe(true)
    expect(isSavedPointColor("#7c3aed")).toBe(false)
    expect(isSavedPointColor("inherited")).toBe(false)

    expect(isValidSavedPointCoordinate(-180, -90)).toBe(true)
    expect(isValidSavedPointCoordinate(180, 90)).toBe(true)
    expect(isValidSavedPointCoordinate(180.000001, 0)).toBe(false)
    expect(isValidSavedPointCoordinate(0, -90.000001)).toBe(false)
    expect(isValidSavedPointCoordinate(Number.NaN, 0)).toBe(false)
    expect(isValidSavedPointCoordinate(0, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
