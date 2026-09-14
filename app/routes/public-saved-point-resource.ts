import { apiUrl, isServerEnabled } from "~/lib/server/config"
import { isValidSavedPointInput } from "~shared/saved-points"
import type { SavedPoint } from "~shared/saved-points"
import type { Route } from "./+types/public-saved-point-resource"

export interface PublicSavedPointResourceData {
  point: SavedPoint | null
}

function isValidSavedPointResponse(value: unknown): value is SavedPoint {
  if (typeof value !== "object" || value === null) return false
  const point = value as SavedPoint
  return (
    isValidSavedPointInput(point) &&
    typeof point.createdAt === "number" &&
    Number.isFinite(point.createdAt) &&
    typeof point.updatedAt === "number" &&
    Number.isFinite(point.updatedAt)
  )
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<PublicSavedPointResourceData> {
  const savedPointId = params.savedPointId
  if (!savedPointId || !isServerEnabled) return { point: null }

  try {
    const response = await fetch(
      apiUrl(`/api/public/saved-points/${encodeURIComponent(savedPointId)}`),
      { signal: request.signal }
    )
    if (!response.ok) return { point: null }
    const point: unknown = await response.json()
    return {
      point:
        isValidSavedPointResponse(point) && point.id === savedPointId
          ? point
          : null,
    }
  } catch {
    return { point: null }
  }
}
