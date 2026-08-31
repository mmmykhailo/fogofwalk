import { describe, expect, test } from "bun:test"
import { haversineKm } from "./stats"
import {
  computePerActivityUniqueDistances,
  type UniqueDistanceActivity,
} from "./uniqueDistance"

const GRID_SCALE = 1000

function referenceImplementation(
  activities: UniqueDistanceActivity[]
): Map<string, number> {
  const explored = new Set<string>()
  const result = new Map<string, number>()

  for (const activity of activities) {
    let uniqueKm = 0
    for (let i = 1; i < activity.coordinates.length; i++) {
      const [lng1, lat1] = activity.coordinates[i - 1]
      const [lng2, lat2] = activity.coordinates[i]
      const cx = Math.round(((lng1 + lng2) / 2) * GRID_SCALE)
      const cy = Math.round(((lat1 + lat2) / 2) * GRID_SCALE)
      if (!explored.has(`${cx},${cy}`)) {
        uniqueKm += haversineKm(lng1, lat1, lng2, lat2)
      }
    }

    for (let i = 1; i < activity.coordinates.length; i++) {
      const [lng1, lat1] = activity.coordinates[i - 1]
      const [lng2, lat2] = activity.coordinates[i]
      const cx = Math.round(((lng1 + lng2) / 2) * GRID_SCALE)
      const cy = Math.round(((lat1 + lat2) / 2) * GRID_SCALE)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          explored.add(`${cx + dx},${cy + dy}`)
        }
      }
    }
    result.set(activity.id, uniqueKm)
  }

  return result
}

describe("computePerActivityUniqueDistances", () => {
  test("matches the expanded string-grid algorithm", () => {
    const activities: UniqueDistanceActivity[] = [
      {
        id: "first",
        coordinates: [
          [14.4, 50.08],
          [14.401, 50.081],
          [14.402, 50.082],
          [14.404, 50.083],
        ],
      },
      {
        id: "overlapping",
        coordinates: [
          [14.4005, 50.0805],
          [14.4015, 50.0815],
          [14.406, 50.084],
        ],
      },
      {
        id: "new-ground",
        coordinates: [
          [-122.42, 37.77],
          [-122.421, 37.771],
        ],
      },
    ]

    expect([...computePerActivityUniqueDistances(activities)]).toEqual([
      ...referenceImplementation(activities),
    ])
  })

  test("does not let segments overlap other segments in the same activity", () => {
    const activity: UniqueDistanceActivity = {
      id: "dense",
      coordinates: [
        [14.4, 50.08],
        [14.40001, 50.08001],
        [14.40002, 50.08002],
      ],
    }

    const result = computePerActivityUniqueDistances([activity])
    const expected =
      haversineKm(14.4, 50.08, 14.40001, 50.08001) +
      haversineKm(14.40001, 50.08001, 14.40002, 50.08002)
    expect(result.get("dense")).toBeCloseTo(expected, 12)
  })
})
