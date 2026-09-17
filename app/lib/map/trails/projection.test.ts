import { describe, expect, test } from "bun:test"
import {
  TRAIL_MAX_COORDINATES_PER_FEATURE,
  WEB_MERCATOR_RADIUS_METERS,
  WEB_MERCATOR_WORLD_LIMIT_METERS,
} from "~/constants/trails"
import {
  projectTrailGeometry,
  webMercatorCoordinateToLngLat,
} from "~/lib/map/trails/projection"
import { TrailTileError } from "~/lib/map/trails/types"

function projectLngLat(lng: number, lat: number): [number, number] {
  const latitudeRadians = (lat * Math.PI) / 180
  return [
    (lng * Math.PI * WEB_MERCATOR_RADIUS_METERS) / 180,
    WEB_MERCATOR_RADIUS_METERS *
      Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  ]
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

describe("trail projection", () => {
  test("converts the origin and a known Prague coordinate", () => {
    expect(webMercatorCoordinateToLngLat([0, 0])).toEqual([0, 0])

    const projectedPrague = projectLngLat(14.4378, 50.0755)
    const result = webMercatorCoordinateToLngLat(projectedPrague)
    expect(result?.[0]).toBeCloseTo(14.4378, 9)
    expect(result?.[1]).toBeCloseTo(50.0755, 9)
  })

  test("converts both supported line geometry types", () => {
    const line = projectTrailGeometry(
      {
        type: "LineString",
        coordinates: [
          [-100, -100],
          [100, 100],
        ],
      },
      10
    )
    const multiLine = projectTrailGeometry(
      {
        type: "MultiLineString",
        coordinates: [
          [
            [-100, -100],
            [0, 0],
          ],
          [
            [0, 0],
            [100, 100],
          ],
        ],
      },
      10
    )

    expect(line?.geometry.type).toBe("LineString")
    expect(line?.coordinateCount).toBe(2)
    expect(multiLine?.geometry.type).toBe("MultiLineString")
    expect(multiLine?.coordinateCount).toBe(4)
  })

  test("maps the Web Mercator world limits to the projection limits", () => {
    const southwest = webMercatorCoordinateToLngLat([
      -WEB_MERCATOR_WORLD_LIMIT_METERS,
      -WEB_MERCATOR_WORLD_LIMIT_METERS,
    ])
    const northeast = webMercatorCoordinateToLngLat([
      WEB_MERCATOR_WORLD_LIMIT_METERS,
      WEB_MERCATOR_WORLD_LIMIT_METERS,
    ])

    expect(southwest?.[0]).toBeCloseTo(-180, 9)
    expect(southwest?.[1]).toBeCloseTo(-85.0511287798066, 9)
    expect(northeast?.[0]).toBeCloseTo(180, 9)
    expect(northeast?.[1]).toBeCloseTo(85.0511287798066, 9)
  })

  test("accepts only finite numeric coordinates in the bounded world", () => {
    expect(webMercatorCoordinateToLngLat([Number.NaN, 0])).toBeNull()
    expect(
      webMercatorCoordinateToLngLat([0, Number.POSITIVE_INFINITY])
    ).toBeNull()
    expect(webMercatorCoordinateToLngLat(["0", 0])).toBeNull()
    expect(webMercatorCoordinateToLngLat([0])).toBeNull()
    expect(
      webMercatorCoordinateToLngLat([WEB_MERCATOR_WORLD_LIMIT_METERS + 1.1, 0])
    ).toBeNull()
    expect(
      webMercatorCoordinateToLngLat([0, -WEB_MERCATOR_WORLD_LIMIT_METERS - 1.1])
    ).toBeNull()
  })

  test("rejects empty, one-point, and broken lines", () => {
    expect(
      projectTrailGeometry({ type: "LineString", coordinates: [] }, 10)
    ).toBeNull()
    expect(
      projectTrailGeometry({ type: "LineString", coordinates: [[0, 0]] }, 10)
    ).toBeNull()
    expect(
      projectTrailGeometry(
        {
          type: "MultiLineString",
          coordinates: [[[0, 0]]],
        },
        10
      )
    ).toBeNull()
    expect(
      projectTrailGeometry(
        {
          type: "LineString",
          coordinates: [
            [0, 0],
            [Number.NaN, 1],
          ],
        },
        10
      )
    ).toBeNull()
  })

  test("enforces feature and remaining tile coordinate limits", () => {
    const denseLine = {
      type: "LineString",
      coordinates: Array.from(
        { length: TRAIL_MAX_COORDINATES_PER_FEATURE + 1 },
        () => [0, 0]
      ),
    }

    expect(() => projectTrailGeometry(denseLine, 100_000)).toThrow(
      TrailTileError
    )
    expect(() => projectTrailGeometry(denseLine, 2)).toThrow(TrailTileError)
  })

  test("does not mutate deeply frozen input", () => {
    const input = deepFreeze({
      type: "MultiLineString",
      coordinates: [
        [
          [-100, -100, 20],
          [100, 100, 21],
        ],
      ],
    })

    const result = projectTrailGeometry(input, 10)
    expect(result?.geometry.type).toBe("MultiLineString")
    if (result?.geometry.type !== "MultiLineString") return
    expect(result.geometry.coordinates[0]?.[0]?.[0]).toBeCloseTo(
      -0.0008983152841195215,
      12
    )
    expect(result.geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo(
      -0.0008983152841195215,
      12
    )
    expect(result.geometry.coordinates[0]?.[1]?.[0]).toBeCloseTo(
      0.0008983152841195215,
      12
    )
    expect(result.geometry.coordinates[0]?.[1]?.[1]).toBeCloseTo(
      0.0008983152841195215,
      12
    )
  })
})
