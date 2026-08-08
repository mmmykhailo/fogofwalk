/**
 * Manifest cursor paging — shared by every driver so the tricky part exists
 * once.
 *
 * ## The problem
 *
 * `ManifestPage.cursor` is a plain number on the wire, so the cursor can only
 * be a timestamp: `updated_at` for tracks, `deleted_at` for tombstones. Rows
 * that share a millisecond therefore cannot be separated by the cursor alone,
 * and the two classic failure modes are:
 *
 * - `WHERE t > since` — silently **skips** every sibling row that shares the
 *   last served millisecond.
 * - `WHERE t >= since` with `cursor = lastSeen` — **loops forever** when one
 *   millisecond holds more rows than a page.
 *
 * ## The rule used here
 *
 * 1. The cursor is an **inclusive lower bound** (`t >= since`), so a row can
 *    never fall through the gap. Re-serving a row is harmless: the client
 *    applies the manifest idempotently (content-hash keyed).
 * 2. Rows are ordered by the deterministic composite key
 *    `(t, contentHash)`, and **a page never splits a millisecond**. The page
 *    stops at the last row before the first timestamp that would be cut in
 *    half, and the cursor becomes exactly that timestamp. Included rows are
 *    all `< cursor`, excluded rows are all `>= cursor`: no skips, no repeats.
 * 3. When one millisecond holds more rows than a page, rule 2 would emit an
 *    empty page, so the window is widened (×4) until a distinct timestamp
 *    appears or the table runs dry. That millisecond is then served whole —
 *    a page may exceed `SYNC_PAGE_SIZE` in that (pathological) case, which is
 *    the price of guaranteed forward progress.
 * 4. On the last page the cursor stays at the newest timestamp served
 *    (**not** +1), so a row written into that same millisecond after the read
 *    is picked up by the next sync instead of being lost. The cost is that the
 *    final millisecond group is re-sent once per sync.
 *
 * A page carries one cursor for two streams (tracks and tombstones), so the
 * combined cursor is the **minimum** of the boundaries of the streams that
 * still have more rows — a stream that is fully drained imposes no constraint,
 * because nothing of its is left unserved. When both are drained the cursor is
 * the **maximum** timestamp served, which is safe for the same reason and
 * avoids dragging the cursor back to an ancient tombstone every sync.
 */

/** Anything the pager can order: a timestamp plus a deterministic tiebreak. */
export interface Pageable {
  time: number
  contentHash: string
}

/**
 * Fetches rows with `time >= since`, ordered by `(time, contentHash)`, at most
 * `limit` of them.
 */
export type PageFetcher<T extends Pageable> = (
  since: number,
  limit: number
) => Promise<T[]> | T[]

export interface StreamPage<T> {
  rows: T[]
  /** Set only when `hasMore` — the exclusive upper bound of this page. */
  boundary: number | null
  /** Newest timestamp actually served, or null for an empty page. */
  lastTime: number | null
  hasMore: boolean
}

export function comparePageable(a: Pageable, b: Pageable): number {
  if (a.time !== b.time) return a.time - b.time
  return a.contentHash < b.contentHash
    ? -1
    : a.contentHash > b.contentHash
      ? 1
      : 0
}

/** Applies rules 1–4 above to a single stream. */
export async function pageStream<T extends Pageable>(
  fetcher: PageFetcher<T>,
  since: number,
  pageSize: number
): Promise<StreamPage<T>> {
  let limit = pageSize + 1

  for (;;) {
    const rows = await fetcher(since, limit)

    if (rows.length < limit) {
      // The table is exhausted inside this window: everything >= since fits.
      const last = rows[rows.length - 1]
      return {
        rows,
        boundary: null,
        lastTime: last ? last.time : null,
        hasMore: false,
      }
    }

    // rows.length === limit, so at least one more row exists. The last row is
    // the first candidate for the next page; anything sharing its timestamp
    // must move with it so the millisecond is not split.
    const boundary = rows[rows.length - 1]!.time
    const included = rows
      .slice(0, rows.length - 1)
      .filter((r) => r.time < boundary)

    if (included.length > 0) {
      return {
        rows: included,
        boundary,
        lastTime: included[included.length - 1]!.time,
        hasMore: true,
      }
    }

    // Degenerate case: the whole window is one millisecond. Widen and retry —
    // this terminates because each pass either finds a distinct timestamp or
    // drains the table.
    limit *= 4
  }
}

export interface CombinedCursor {
  cursor: number
  hasMore: boolean
}

/** Folds the per-stream results into the single wire cursor. */
export function combineCursors(
  since: number,
  pages: StreamPage<Pageable>[]
): CombinedCursor {
  const boundaries = pages
    .filter((page) => page.hasMore && page.boundary !== null)
    .map((page) => page.boundary!)

  if (boundaries.length > 0) {
    return { cursor: Math.min(...boundaries), hasMore: true }
  }

  const lastTimes = pages
    .map((page) => page.lastTime)
    .filter((time): time is number => time !== null)

  return {
    cursor: lastTimes.length > 0 ? Math.max(...lastTimes) : since,
    hasMore: false,
  }
}
