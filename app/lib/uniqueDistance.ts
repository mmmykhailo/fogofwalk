import { haversineKm } from "~/lib/stats"

// 0.001° ≈ 111 m per cell, matching FOG_CLEAR_RADIUS_METERS = 100 m.
const GRID_SCALE = 1000
// Includes the one-cell neighbourhood just outside the valid coordinate range.
const MIN_GRID_X = -180_001
const MIN_GRID_Y = -90_001
const GRID_HEIGHT = 180_003

export interface UniqueDistanceActivity {
  id: string
  coordinates: [number, number][]
}

/** Packs a grid coordinate into a collision-free integer below Number.MAX_SAFE_INTEGER. */
function cellKey(x: number, y: number): number {
  return (x - MIN_GRID_X) * GRID_HEIGHT + (y - MIN_GRID_Y)
}

/**
 * Computes unique distance for chronologically sorted activities.
 *
 * Only activity centre cells are retained. Looking for any previously explored
 * centre in the current cell's 3×3 neighbourhood is equivalent to expanding
 * every old centre into nine string keys, while using one numeric key per cell.
 */
export function computePerActivityUniqueDistances(
  activities: UniqueDistanceActivity[]
): Map<string, number> {
  const exploredCentres = new Set<number>()
  const result = new Map<string, number>()

  for (const activity of activities) {
    let activityUniqueKm = 0
    const activityCentres = new Set<number>()
    const coords = activity.coordinates

    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1]
      const [lng2, lat2] = coords[i]
      const cx = Math.round(((lng1 + lng2) / 2) * GRID_SCALE)
      const cy = Math.round(((lat1 + lat2) / 2) * GRID_SCALE)
      activityCentres.add(cellKey(cx, cy))

      let wasExplored = false
      for (let dx = -1; dx <= 1 && !wasExplored; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (exploredCentres.has(cellKey(cx + dx, cy + dy))) {
            wasExplored = true
            break
          }
        }
      }

      if (!wasExplored) {
        activityUniqueKm += haversineKm(lng1, lat1, lng2, lat2)
      }
    }

    for (const key of activityCentres) exploredCentres.add(key)
    result.set(activity.id, activityUniqueKm)
  }

  return result
}
