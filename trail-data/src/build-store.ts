import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { Database } from "bun:sqlite"

import type { TrailMembership } from "./classifier"
import type { RelationGraphRelation } from "./relation-graph"
import type {
  OsmNode,
  OsmRelation,
  OsmRelationMember,
  OsmWay,
} from "./osm-xml-fixture"

export interface StoreCounters {
  duplicateSourceObjects: number
  sourceConflicts: number
}

export interface SelectedWay {
  way: OsmWay
  memberships: TrailMembership[]
}

interface RelationRow {
  id: number
  version: number
  tags: string
  members: string
}

interface WayRow {
  id: number
  version: number
  tags: string
  node_refs: string
}

interface NodeRow {
  id: number
  version: number
  lon: number
  lat: number
  tags: string
}

interface MembershipRow {
  relation_id: number
  kind: "hiking" | "cycling"
  network_rank: number
  color: string
  inherited: number
}

/** SQLite is a temporary offline build index, never a runtime service. */
export class BuildStore {
  readonly db: Database
  readonly counters: StoreCounters = {
    duplicateSourceObjects: 0,
    sourceConflicts: 0,
  }

  private constructor(readonly path: string) {
    this.db = new Database(path)
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")
    this.db.run("PRAGMA temp_store = FILE")
    this.db.run("PRAGMA foreign_keys = ON")
    this.db.run(`
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        tags TEXT NOT NULL,
        members TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relation_members (
        relation_id INTEGER NOT NULL REFERENCES relations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        ref INTEGER NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (relation_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS ways (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        tags TEXT NOT NULL,
        node_refs TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        tags TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        way_id INTEGER NOT NULL,
        relation_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        network_rank INTEGER NOT NULL,
        color TEXT NOT NULL,
        inherited INTEGER NOT NULL,
        PRIMARY KEY (way_id, relation_id, kind, color)
      );
      CREATE TABLE IF NOT EXISTS wanted_ways (
        way_id INTEGER PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS wanted_nodes (
        node_id INTEGER PRIMARY KEY
      );
      CREATE INDEX IF NOT EXISTS relation_members_ref ON relation_members(ref, type);
      CREATE INDEX IF NOT EXISTS memberships_way ON memberships(way_id);
      CREATE INDEX IF NOT EXISTS ways_id ON ways(id);
      CREATE INDEX IF NOT EXISTS nodes_id ON nodes(id);
    `)
  }

  static async open(path: string): Promise<BuildStore> {
    await mkdir(dirname(path), { recursive: true })
    return new BuildStore(path)
  }

  withTransaction<T>(callback: () => T): T {
    this.db.run("BEGIN")
    try {
      const result = callback()
      this.db.run("COMMIT")
      return result
    } catch (error) {
      this.db.run("ROLLBACK")
      throw error
    }
  }

  addRelation(relation: OsmRelation | RelationGraphRelation): void {
    const normalized = {
      id: relation.id,
      version: relation.version ?? 1,
      tags: canonicalJson(relation.tags),
      members: canonicalJson(relation.members),
    }
    const existing = this.db
      .query<
        RelationRow,
        number
      >("SELECT id, version, tags, members FROM relations WHERE id = ?")
      .get(relation.id)
    if (existing) {
      if (
        existing.version === normalized.version &&
        existing.tags === normalized.tags &&
        existing.members === normalized.members
      ) {
        this.counters.duplicateSourceObjects++
        return
      }
      if (existing.version === normalized.version) {
        this.counters.sourceConflicts++
        throw new Error(
          `conflicting relation ${relation.id} has the same OSM version`
        )
      }
      if (existing.version > normalized.version) {
        this.counters.duplicateSourceObjects++
        return
      }
    }

    this.db.run(
      `INSERT INTO relations(id, version, tags, members) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version=excluded.version, tags=excluded.tags, members=excluded.members`,
      [normalized.id, normalized.version, normalized.tags, normalized.members]
    )
    this.db.run("DELETE FROM relation_members WHERE relation_id = ?", [
      relation.id,
    ])
    const insert = this.db.prepare(
      "INSERT INTO relation_members(relation_id, sequence, type, ref, role) VALUES (?, ?, ?, ?, ?)"
    )
    try {
      relation.members.forEach((member, sequence) => {
        insert.run(relation.id, sequence, member.type, member.ref, member.role)
      })
    } finally {
      insert.finalize()
    }
  }

  *iterateRelations(): IterableIterator<RelationGraphRelation> {
    const statement = this.db.query<RelationRow, []>(
      "SELECT id, version, tags, members FROM relations ORDER BY id"
    )
    try {
      for (const row of statement.iterate()) {
        const members = this.db
          .query<
            { type: OsmRelationMember["type"]; ref: number; role: string },
            number
          >("SELECT type, ref, role FROM relation_members WHERE relation_id = ? ORDER BY sequence")
          .all(row.id)
        yield {
          id: row.id,
          version: row.version,
          tags: JSON.parse(row.tags),
          members,
        }
      }
    } finally {
      statement.finalize()
    }
  }

  replaceMemberships(membershipsByWay: Map<number, TrailMembership[]>): void {
    this.withTransaction(() => {
      this.db.run("DELETE FROM memberships")
      this.db.run("DELETE FROM wanted_ways")
      const insertMembership = this.db.prepare(
        `INSERT OR IGNORE INTO memberships
          (way_id, relation_id, kind, network_rank, color, inherited)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      const insertWay = this.db.prepare(
        "INSERT OR IGNORE INTO wanted_ways(way_id) VALUES (?)"
      )
      try {
        for (const wayId of [...membershipsByWay.keys()].sort(
          (a, b) => a - b
        )) {
          insertWay.run(wayId)
          for (const membership of membershipsByWay.get(wayId) ?? []) {
            insertMembership.run(
              wayId,
              membership.relationId,
              membership.kind,
              membership.networkRank,
              membership.color,
              membership.inherited ? 1 : 0
            )
          }
        }
      } finally {
        insertMembership.finalize()
        insertWay.finalize()
      }
    })
  }

  addWay(way: OsmWay): boolean {
    if (!this.isWantedWay(way.id)) return false
    return this.upsertWay(way)
  }

  addWays(ways: OsmWay[]): number {
    const wanted = this.wantedIds(
      "wanted_ways",
      "way_id",
      ways.map((way) => way.id)
    )
    let retained = 0
    for (const way of ways) {
      if (wanted.has(way.id) && this.upsertWay(way)) retained++
    }
    return retained
  }

  addNode(node: OsmNode): boolean {
    if (!this.isWantedNode(node.id)) return false
    return this.upsertNode(node)
  }

  addNodes(nodes: OsmNode[]): number {
    const wanted = this.wantedIds(
      "wanted_nodes",
      "node_id",
      nodes.map((node) => node.id)
    )
    let retained = 0
    for (const node of nodes) {
      if (wanted.has(node.id) && this.upsertNode(node)) retained++
    }
    return retained
  }

  private upsertWay(way: OsmWay): boolean {
    return this.upsertVersioned(
      "way",
      way.id,
      way.version,
      canonicalJson(way.tags),
      canonicalJson(way.nodeRefs),
      (existing) =>
        existing.tags === canonicalJson(way.tags) &&
        existing.node_refs === canonicalJson(way.nodeRefs),
      () => {
        this.db.run(
          `INSERT INTO ways(id, version, tags, node_refs) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET version=excluded.version, tags=excluded.tags, node_refs=excluded.node_refs`,
          [
            way.id,
            way.version,
            canonicalJson(way.tags),
            canonicalJson(way.nodeRefs),
          ]
        )
      }
    )
  }

  private upsertNode(node: OsmNode): boolean {
    const existing = this.db
      .query<
        NodeRow,
        number
      >("SELECT id, version, lon, lat, tags FROM nodes WHERE id = ?")
      .get(node.id)
    const same =
      existing &&
      existing.version === node.version &&
      existing.lon === node.lon &&
      existing.lat === node.lat &&
      existing.tags === canonicalJson(node.tags)
    if (same) {
      this.counters.duplicateSourceObjects++
      return false
    }
    if (existing && existing.version === node.version) {
      this.counters.sourceConflicts++
      throw new Error(`conflicting node ${node.id} has the same OSM version`)
    }
    if (existing && existing.version > node.version) {
      this.counters.duplicateSourceObjects++
      return false
    }
    this.db.run(
      `INSERT INTO nodes(id, version, lon, lat, tags) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version=excluded.version, lon=excluded.lon, lat=excluded.lat, tags=excluded.tags`,
      [node.id, node.version, node.lon, node.lat, canonicalJson(node.tags)]
    )
    return true
  }

  populateWantedNodes(): void {
    this.withTransaction(() => {
      this.db.run("DELETE FROM wanted_nodes")
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO wanted_nodes(node_id) VALUES (?)"
      )
      const ways = this.db.query<{ node_refs: string }, []>(
        "SELECT node_refs FROM ways WHERE id IN (SELECT way_id FROM wanted_ways) ORDER BY id"
      )
      try {
        for (const way of ways.iterate()) {
          for (const nodeId of JSON.parse(way.node_refs) as number[]) {
            insert.run(nodeId)
          }
        }
      } finally {
        ways.finalize()
        insert.finalize()
      }
    })
  }

  isWantedWay(id: number): boolean {
    return Boolean(
      this.db
        .query<
          { way_id: number },
          number
        >("SELECT way_id FROM wanted_ways WHERE way_id = ?")
        .get(id)
    )
  }

  isWantedNode(id: number): boolean {
    return Boolean(
      this.db
        .query<
          { node_id: number },
          number
        >("SELECT node_id FROM wanted_nodes WHERE node_id = ?")
        .get(id)
    )
  }

  *iterateSelectedWays(): IterableIterator<SelectedWay> {
    const statement = this.db.query<WayRow, []>(
      "SELECT id, version, tags, node_refs FROM ways WHERE id IN (SELECT way_id FROM wanted_ways) ORDER BY id"
    )
    try {
      for (const row of statement.iterate()) {
        const membershipRows = this.db
          .query<MembershipRow, number>(
            `SELECT relation_id, kind, network_rank, color, inherited
             FROM memberships WHERE way_id = ? ORDER BY relation_id, kind, color`
          )
          .all(row.id)
        yield {
          way: {
            id: row.id,
            version: row.version,
            tags: JSON.parse(row.tags),
            nodeRefs: JSON.parse(row.node_refs),
          },
          memberships: membershipRows.map((membership) => ({
            relationId: membership.relation_id,
            kind: membership.kind,
            networkRank: membership.network_rank,
            color: membership.color,
            inherited: Boolean(membership.inherited),
          })),
        }
      }
    } finally {
      statement.finalize()
    }
  }

  nodesForRefs(refs: number[]): Map<number, OsmNode> {
    const result = new Map<number, OsmNode>()
    for (let offset = 0; offset < refs.length; offset += 500) {
      const batch = refs.slice(offset, offset + 500)
      if (batch.length === 0) continue
      const placeholders = batch.map(() => "?").join(",")
      const rows = this.db
        .query<
          NodeRow,
          number[]
        >(`SELECT id, version, lon, lat, tags FROM nodes WHERE id IN (${placeholders})`)
        .all(...batch)
      for (const row of rows) {
        result.set(row.id, {
          id: row.id,
          version: row.version,
          lon: row.lon,
          lat: row.lat,
          tags: JSON.parse(row.tags),
        })
      }
    }
    return result
  }

  count(table: "relations" | "ways" | "nodes" | "memberships"): number {
    const row = this.db
      .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`)
      .get()
    return Number(row?.count ?? 0)
  }

  close(): void {
    this.db.close(true)
  }

  private upsertVersioned(
    type: "way",
    id: number,
    version: number,
    tags: string,
    refs: string,
    equal: (existing: WayRow) => boolean,
    replace: () => void
  ): boolean {
    const existing = this.db
      .query<
        WayRow,
        number
      >("SELECT id, version, tags, node_refs FROM ways WHERE id = ?")
      .get(id)
    if (!existing) {
      replace()
      return true
    }
    if (existing.version === version && equal(existing)) {
      this.counters.duplicateSourceObjects++
      return false
    }
    if (existing.version === version) {
      this.counters.sourceConflicts++
      throw new Error(`conflicting ${type} ${id} has the same OSM version`)
    }
    if (existing.version > version) {
      this.counters.duplicateSourceObjects++
      return false
    }
    replace()
    return true
  }

  private wantedIds(
    table: "wanted_ways" | "wanted_nodes",
    column: "way_id" | "node_id",
    ids: number[]
  ): Set<number> {
    const wanted = new Set<number>()
    const uniqueIds = [...new Set(ids)]
    for (let offset = 0; offset < uniqueIds.length; offset += 500) {
      const batch = uniqueIds.slice(offset, offset + 500)
      if (batch.length === 0) continue
      const placeholders = batch.map(() => "?").join(",")
      const rows = this.db
        .query<
          { way_id?: number; node_id?: number },
          number[]
        >(`SELECT ${column} FROM ${table} WHERE ${column} IN (${placeholders})`)
        .all(...batch)
      for (const row of rows) {
        const id = row[column]
        if (typeof id === "number") wanted.add(id)
      }
    }
    return wanted
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
