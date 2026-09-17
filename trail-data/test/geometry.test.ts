import { expect, test } from "bun:test"

import {
  assembleWayFeatures,
  boundsForCoordinates,
  projectWebMercator,
  tileRangeForCoordinates,
} from "../src/geometry"

test("assembles only complete line geometry and preserves selected visual properties", () => {
  const result = assembleWayFeatures(
    { id: 10, version: 1, nodeRefs: [1, 2], tags: {} },
    new Map([
      [1, { id: 1, version: 1, lon: 14, lat: 50, tags: {} }],
      [2, { id: 2, version: 1, lon: 14.1, lat: 50.1, tags: {} }],
    ]),
    [
      {
        relationId: 20,
        kind: "hiking",
        networkRank: 3,
        color: "#d9272e",
        inherited: false,
      },
    ]
  )
  expect(result.invalid).toBe(false)
  expect(result.features[0]?.properties).toEqual({
    kind: "hiking",
    color: "#d9272e",
    offset: 0,
    sort: 13,
  })
  expect(
    assembleWayFeatures(
      { id: 11, version: 1, nodeRefs: [1, 99], tags: {} },
      new Map([[1, { id: 1, version: 1, lon: 14, lat: 50, tags: {} }]]),
      []
    ).invalid
  ).toBe(true)
})

test("projects coordinates and calculates bounded z12 tile ranges", () => {
  const projected = projectWebMercator([0, 0])
  expect(projected[0]).toBe(0.5)
  expect(projected[1]).toBe(0.5)
  const range = tileRangeForCoordinates(
    [
      [14, 50],
      [14.1, 50.1],
    ],
    12
  )
  expect(range.minX).toBeLessThanOrEqual(range.maxX)
  expect(range.minY).toBeLessThanOrEqual(range.maxY)
  expect(range.minX).toBeGreaterThanOrEqual(0)
  expect(range.maxX).toBeLessThan(2 ** 12)
  expect(
    boundsForCoordinates([
      [14, 50],
      [14.1, 50.1],
    ])
  ).toEqual({ minLon: 14, minLat: 50, maxLon: 14.1, maxLat: 50.1 })
})
