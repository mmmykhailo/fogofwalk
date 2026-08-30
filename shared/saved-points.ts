/**
 * Saved-point data shared by the browser and sync server.
 *
 * Keep validation-adjacent decisions here so an offline edit is accepted by
 * the server exactly when it is accepted by the editor.
 */

export const SAVED_POINT_NAME_MAX_LENGTH = 120
export const SAVED_POINT_DESCRIPTION_MAX_LENGTH = 2_000

/** JavaScript strings are UTF-16; product limits are Unicode code points. */
export function savedPointTextLength(value: string): number {
  return Array.from(value).length
}

/** A small, high-contrast palette. Values are resolved by the client UI. */
export const SAVED_POINT_COLORS = {
  red: "#dc2626",
  orange: "#ea580c",
  amber: "#d97706",
  green: "#16a34a",
  teal: "#0f766e",
  blue: "#2563eb",
  purple: "#7c3aed",
  pink: "#db2777",
} as const

export type SavedPointColor = keyof typeof SAVED_POINT_COLORS

export interface SavedPoint {
  id: string
  lng: number
  lat: number
  name: string
  description: string | null
  color: SavedPointColor
  isPublic: boolean
  /** Milliseconds since Unix epoch, assigned by the server where available. */
  createdAt: number
  /** Milliseconds since Unix epoch, assigned by the server where available. */
  updatedAt: number
}

export interface SavedPointInput {
  id: string
  lng: number
  lat: number
  name: string
  description?: string | null
  color: SavedPointColor
  isPublic: boolean
}

export function isSavedPointColor(value: unknown): value is SavedPointColor {
  return typeof value === "string" && value in SAVED_POINT_COLORS
}

export function isValidSavedPointCoordinate(
  lng: unknown,
  lat: unknown
): lng is number {
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

/** Trim text without silently truncating it; callers validate the returned data. */
export function normalizeSavedPointInput(
  input: SavedPointInput
): SavedPointInput {
  const description = input.description?.trim() ?? ""
  return {
    ...input,
    name: input.name.trim(),
    description: description || null,
  }
}

export function isValidSavedPointInput(input: SavedPointInput): boolean {
  const normalized = normalizeSavedPointInput(input)
  return (
    normalized.id.length > 0 &&
    normalized.name.length > 0 &&
    savedPointTextLength(normalized.name) <= SAVED_POINT_NAME_MAX_LENGTH &&
    (normalized.description == null ||
      savedPointTextLength(normalized.description) <=
        SAVED_POINT_DESCRIPTION_MAX_LENGTH) &&
    isSavedPointColor(normalized.color) &&
    typeof normalized.isPublic === "boolean" &&
    isValidSavedPointCoordinate(normalized.lng, normalized.lat)
  )
}
