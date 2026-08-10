/**
 * The manifest cursor is the one place where an off-by-one silently loses a
 * user's data, so it is tested at two levels: the pure pager, and a full store
 * paged to exhaustion with timestamps deliberately colliding on the page
 * boundary.
 */

import { describe, expect, test } from "bun:test"

import type { TrackMeta } from "~shared/api"
import { SYNC_PAGE_SIZE } from "~shared/constants"

import {
  combineCursors,
  pageStream,
  type Pageable,
} from "../src/store/manifestPaging"
import { MemoryStore } from "../src/store/memory"
import { fakeHash, makeStats } from "./helpers"

function rowsAt(times: number[]): Pageable[] {
  return times
    .map((time, index) => ({ time, contentHash: fakeHash(index) }))
    .sort((a, b) =>
      a.time === b.time
        ? a.contentHash.localeCompare(b.contentHash)
        : a.time - b.time
    )
}

const fetcherFor =
  (rows: Pageable[]) =>
  (since: number, limit: number): Pageable[] =>
    rows.filter((row) => row.time >= since).slice(0, limit)

describe("pageStream", () => {
  test("returns everything when it fits", async () => {
    const rows = rowsAt([1, 2, 3])
    const page = await pageStream(fetcherFor(rows), 0, 10)
    expect(page.rows).toHaveLength(3)
    expect(page.hasMore).toBe(false)
    expect(page.lastTime).toBe(3)
  })

  test("never splits a millisecond across a page boundary", async () => {
    // Page size 3, but rows 3 and 4 share a timestamp: the page has to stop
    // before them rather than serve half the group.
    const rows = rowsAt([1, 2, 3, 4, 4, 5])
    const page = await pageStream(fetcherFor(rows), 0, 3)

    expect(page.hasMore).toBe(true)
    expect(page.boundary).toBe(4)
    expect(page.rows.map((row) => row.time)).toEqual([1, 2, 3])
  })

  test("widens the window when one millisecond exceeds a page", async () => {
    // Six rows in the same millisecond with a page size of 2: the naive
    // implementation emits an empty page forever. This must serve the whole
    // group in one (oversized) page instead.
    const rows = rowsAt([7, 7, 7, 7, 7, 7, ...Array(8).fill(9)])
    const page = await pageStream(fetcherFor(rows), 0, 2)

    expect(page.rows).toHaveLength(6)
    expect(page.rows.every((row) => row.time === 7)).toBe(true)
    expect(page.hasMore).toBe(true)
    expect(page.boundary).toBe(9)
  })

  test("paging to exhaustion loses nothing and terminates", async () => {
    const times = [1, 1, 1, 2, 3, 3, 4, 4, 4, 4, 5, 9, 9, 9, 12]
    const rows = rowsAt(times)

    const seen = new Set<string>()
    let cursor = 0
    let guard = 0

    for (;;) {
      const page = await pageStream(fetcherFor(rows), cursor, 2)
      for (const row of page.rows) seen.add(row.contentHash)
      const next = combineCursors(cursor, [page])
      if (!next.hasMore) break
      expect(next.cursor).toBeGreaterThan(cursor)
      cursor = next.cursor
      if (++guard > 50) throw new Error("cursor failed to advance")
    }

    expect(seen.size).toBe(times.length)
  })
})

describe("combineCursors", () => {
  test("the stream with more rows constrains the cursor", async () => {
    const tracks = await pageStream(fetcherFor(rowsAt([1, 2, 3, 4])), 0, 2)
    const tombstones = await pageStream(fetcherFor(rowsAt([50])), 0, 2)

    // Tombstones are drained, so they impose no constraint — the cursor must
    // follow the tracks, not jump to 50 and skip tracks 3 and 4.
    expect(combineCursors(0, [tracks, tombstones])).toEqual({
      cursor: 3,
      hasMore: true,
    })
  })

  test("when both streams are drained the cursor is the newest row served", async () => {
    const tracks = await pageStream(fetcherFor(rowsAt([10])), 0, 5)
    const tombstones = await pageStream(fetcherFor(rowsAt([4])), 0, 5)
    expect(combineCursors(0, [tracks, tombstones])).toEqual({
      cursor: 10,
      hasMore: false,
    })
  })

  test("an empty page leaves the cursor where it was", async () => {
    const empty = await pageStream(fetcherFor([]), 42, 5)
    expect(combineCursors(42, [empty])).toEqual({ cursor: 42, hasMore: false })
  })
})

describe("MemoryStore.listManifest", () => {
  test("pages across a boundary crowded with duplicate timestamps", async () => {
    const store = new MemoryStore()
    const userId = "user-a"

    // Three tracks per millisecond, so the SYNC_PAGE_SIZE boundary always
    // lands in the middle of a group.
    const total = SYNC_PAGE_SIZE * 2 + 7
    const hashes: string[] = []
    for (let index = 0; index < total; index += 1) {
      const meta: TrackMeta = {
        contentHash: fakeHash(index),
        name: `track ${index}`,
        format: "gpx",
        startedAtMs: null,
        distanceKm: 1,
        pointCount: 2,
        sizeBytes: 10,
        updatedAt: 1_000 + Math.floor(index / 3),
      }
      hashes.push(meta.contentHash)
      await store.putTrack(userId, meta, new Uint8Array([1]))
    }

    const seen = new Set<string>()
    let cursor = 0
    let pages = 0

    for (;;) {
      const page = await store.listManifest(userId, cursor)
      for (const track of page.tracks) seen.add(track.contentHash)
      pages += 1
      if (!page.hasMore) break
      expect(page.cursor).toBeGreaterThan(cursor)
      cursor = page.cursor
      if (pages > 20) throw new Error("manifest paging failed to terminate")
    }

    expect(pages).toBeGreaterThan(1)
    expect(seen.size).toBe(total)
    for (const hash of hashes) expect(seen.has(hash)).toBe(true)
  })

  test("tombstones and tracks share one cursor without losing either", async () => {
    const store = new MemoryStore()
    const userId = "user-b"

    for (let index = 0; index < 5; index += 1) {
      await store.putTrack(
        userId,
        {
          contentHash: fakeHash(index),
          name: `track ${index}`,
          format: "fit",
          startedAtMs: null,
          distanceKm: 1,
          pointCount: 2,
          sizeBytes: 10,
          updatedAt: 1_000 + index,
        },
        new Uint8Array([1])
      )
    }
    await store.deleteTrack(userId, fakeHash(1))
    await store.deleteTrack(userId, fakeHash(2))

    const page = await store.listManifest(userId, 0)
    expect(page.tracks).toHaveLength(3)
    expect(page.deletions).toHaveLength(2)
    expect(page.hasMore).toBe(false)
  })

  test("a cursor from a previous sync returns only newer rows", async () => {
    const store = new MemoryStore()
    const userId = "user-c"

    await store.putTrack(
      userId,
      {
        contentHash: fakeHash(1),
        name: "old",
        format: "gpx",
        startedAtMs: null,
        distanceKm: 1,
        pointCount: 2,
        sizeBytes: 10,
        updatedAt: 1_000,
      },
      new Uint8Array([1])
    )

    const first = await store.listManifest(userId, 0)
    expect(first.tracks).toHaveLength(1)
    expect(first.cursor).toBe(1_000)

    await store.putTrack(
      userId,
      {
        contentHash: fakeHash(2),
        name: "new",
        format: "gpx",
        startedAtMs: null,
        distanceKm: 1,
        pointCount: 2,
        sizeBytes: 10,
        updatedAt: 2_000,
      },
      new Uint8Array([1])
    )

    const second = await store.listManifest(userId, first.cursor)
    // The final cursor stays *on* the newest row served rather than past it,
    // so the old row is re-sent once — cheap, and it means a row written into
    // that same millisecond after the read can never be lost.
    expect(second.tracks.map((track) => track.name).sort()).toEqual([
      "new",
      "old",
    ])
    expect(second.cursor).toBe(2_000)
  })
})

test("stats fixture stays in sync with the shared type", () => {
  expect(makeStats().uniqueDistanceKm).toBe(0)
})
