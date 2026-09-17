import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { TileSpool } from "../src/tile-spool"

test("deduplicates identical visual memberships per tile and reads one batch", () => {
  const db = new Database(":memory:")
  try {
    const spool = new TileSpool(db)
    const feature = {
      type: "Feature" as const,
      id: 160,
      wayId: 10,
      properties: {
        kind: "hiking" as const,
        color: "#d9272e",
        offset: 0,
        sort: 13,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [14, 50],
          [14.1, 50.1],
        ] as [number, number][],
      },
    }
    expect(spool.addFeature(feature, 12)).toBeGreaterThan(0)
    expect(spool.addFeature(feature, 12)).toBe(0)
    const tileIds = [...spool.tileIds()]
    expect(tileIds.length).toBeGreaterThan(0)
    expect(spool.readTile(tileIds[0] ?? 0)).toHaveLength(1)
  } finally {
    db.close(true)
  }
})
