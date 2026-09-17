import { Database } from "bun:sqlite"

import {
  tileCandidatesForCoordinates,
  type TrailLineFeature,
} from "./geometry"

interface SpoolRow {
  feature: string
}

/** Stores a bounded tile batch on disk instead of retaining all tile features. */
export class TileSpool {
  constructor(private readonly db: Database) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tile_spool (
        tile_id INTEGER NOT NULL,
        unique_key TEXT NOT NULL,
        feature TEXT NOT NULL,
        PRIMARY KEY (tile_id, unique_key)
      );
      CREATE INDEX IF NOT EXISTS tile_spool_tile ON tile_spool(tile_id);
    `)
  }

  addFeature(feature: TrailLineFeature, zoom: number): number {
    const statement = this.db.prepare(
      "INSERT OR IGNORE INTO tile_spool(tile_id, unique_key, feature) VALUES (?, ?, ?)"
    )
    let inserted = 0
    try {
      for (const tileId of tileCandidatesForCoordinates(
        feature.geometry.coordinates,
        zoom
      )) {
        const result = statement.run(
          tileId,
          visualFeatureKey(feature),
          JSON.stringify(feature)
        )
        inserted += result.changes
      }
    } finally {
      statement.finalize()
    }
    return inserted
  }

  *tileIds(): IterableIterator<number> {
    const statement = this.db.query<{ tile_id: number }, []>(
      "SELECT DISTINCT tile_id FROM tile_spool ORDER BY tile_id"
    )
    try {
      for (const row of statement.iterate()) yield row.tile_id
    } finally {
      statement.finalize()
    }
  }

  readTile(tileId: number): TrailLineFeature[] {
    const rows = this.db
      .query<
        SpoolRow,
        number
      >("SELECT feature FROM tile_spool WHERE tile_id = ? ORDER BY unique_key")
      .all(tileId)
    return rows.map((row) => JSON.parse(row.feature) as TrailLineFeature)
  }

  count(): number {
    const row = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM tile_spool")
      .get()
    return Number(row?.count ?? 0)
  }

  clear(): void {
    this.db.run("DELETE FROM tile_spool")
  }
}

export function visualFeatureKey(feature: TrailLineFeature): string {
  return [
    feature.wayId,
    feature.properties.kind,
    feature.properties.color,
    feature.properties.offset,
    feature.properties.sort,
  ].join(":")
}
