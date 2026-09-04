import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import type { ParsedActivity } from "~/types/activities"
import {
  activityToSummary,
  clearActivities,
  deleteActivity,
  loadActivitySummaries,
  saveActivities,
} from "./storage"

type StoreName =
  | "activities"
  | "activity-summaries"
  | "photos"
  | "saved-points"
  | "prefs"

class FakeRequest<T> {
  result!: T
  error: DOMException | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
}

class FakeDatabase {
  readonly stores = new Map<StoreName, Map<string, unknown>>()
  readonly metrics = {
    activityGetAll: 0,
    activityGetAllKeys: 0,
  }
  failWrites = false
  duplicateSummaryRecords: unknown[] = []

  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name as StoreName),
  }

  createObjectStore(name: string): void {
    this.stores.set(name as StoreName, new Map())
  }

  deleteObjectStore(name: string): void {
    this.stores.delete(name as StoreName)
  }

  transaction(
    names: string | string[],
    mode: IDBTransactionMode
  ): FakeTransaction {
    return new FakeTransaction(
      this,
      typeof names === "string" ? [names] : names,
      mode
    )
  }

  raw(name: StoreName): Map<string, unknown> {
    return this.stores.get(name)!
  }

  resetMetrics(): void {
    this.metrics.activityGetAll = 0
    this.metrics.activityGetAllKeys = 0
  }
}

class FakeTransaction {
  error: DOMException | null = null
  oncomplete: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null

  private pending = 0
  private completionQueued = false
  private aborted = false
  private didClear = false
  private readonly staged = new Map<string, Map<string, unknown>>()

  constructor(
    readonly db: FakeDatabase,
    names: readonly string[],
    private readonly mode: IDBTransactionMode
  ) {
    for (const name of names) {
      const store = db.stores.get(name as StoreName)
      if (!store) throw new Error(`Missing fake object store: ${name}`)
      this.staged.set(name, new Map(store))
    }
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.staged.has(name)) {
      const store = this.db.stores.get(name as StoreName)
      if (!store) throw new Error(`Missing fake object store: ${name}`)
      this.staged.set(name, new Map(store))
    }
    return new FakeObjectStore(this, name)
  }

  abort(reason = "fake IndexedDB write failed"): void {
    if (this.aborted) return
    this.aborted = true
    this.error = new DOMException(reason, "UnknownError")
    queueMicrotask(() => this.onabort?.({ target: this } as unknown as Event))
  }

  readStore(name: string): Map<string, unknown> {
    return this.staged.get(name)!
  }

  hasStore(name: string): boolean {
    return this.staged.has(name)
  }

  enqueue<T>(work: () => T, isWrite = false): IDBRequest<T> {
    const request = new FakeRequest<T>()
    this.pending++
    queueMicrotask(() => {
      if (
        this.aborted ||
        (isWrite &&
          this.db.failWrites &&
          (this.hasStore("activities") || this.didClear))
      ) {
        this.abort()
        request.error = this.error
        request.onerror?.({ target: request } as unknown as Event)
      } else {
        try {
          request.result = work()
          request.onsuccess?.({ target: request } as unknown as Event)
        } catch (error) {
          this.abort(
            error instanceof Error ? error.message : "fake request failed"
          )
          request.error = this.error
          request.onerror?.({ target: request } as unknown as Event)
        }
      }
      this.pending--
      this.completeIfIdle()
    })
    return request as unknown as IDBRequest<T>
  }

  private completeIfIdle(): void {
    if (this.pending !== 0 || this.completionQueued || this.aborted) return
    this.completionQueued = true
    queueMicrotask(() => {
      if (this.aborted || this.pending !== 0) return
      for (const [name, store] of this.staged) {
        this.db.stores.set(name as StoreName, store)
      }
      this.oncomplete?.()
    })
  }
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly name: string
  ) {}

  put(value: unknown): IDBRequest<unknown> {
    return this.tx.enqueue(() => {
      const id = (value as { id?: unknown }).id
      if (typeof id !== "string") throw new Error("missing key")
      this.tx.readStore(this.name).set(id, structuredClone(value))
      return id
    }, true) as unknown as IDBRequest<unknown>
  }

  delete(id: IDBValidKey): IDBRequest<undefined> {
    return this.tx.enqueue(() => {
      this.tx.readStore(this.name).delete(String(id))
      return undefined
    }, true)
  }

  clear(): IDBRequest<undefined> {
    this.tx.didClear = true
    return this.tx.enqueue(() => {
      this.tx.readStore(this.name).clear()
      return undefined
    }, true)
  }

  get(id: IDBValidKey): IDBRequest<unknown> {
    return this.tx.enqueue(() => {
      const value = this.tx.readStore(this.name).get(String(id))
      if (
        value === undefined &&
        this.name === "activity-summaries" &&
        !this.tx.hasStore("activities") &&
        !this.tx.didClear
      ) {
        return {
          id: String(id),
          name: `${String(id)}.gpx`,
          startedAtMs: null,
          isPublic: false,
          stats: {
            distanceKm: 0,
            durationMs: null,
            elevationGainM: 0,
            avgMovingSpeedKmh: null,
          },
        }
      }
      return value === undefined ? undefined : structuredClone(value)
    })
  }

  getAll(): IDBRequest<unknown[]> {
    return this.tx.enqueue(() => {
      const values = [...this.tx.readStore(this.name).values()].map((value) =>
        structuredClone(value)
      )
      if (this.name === "activity-summaries") {
        values.push(
          ...this.tx.db.duplicateSummaryRecords.map((value) =>
            structuredClone(value)
          )
        )
      }
      if (this.name === "activities") this.tx.db.metrics.activityGetAll++
      return values
    })
  }

  getAllKeys(): IDBRequest<IDBValidKey[]> {
    return this.tx.enqueue(() => {
      if (this.name === "activities") this.tx.db.metrics.activityGetAllKeys++
      return [...this.tx.readStore(this.name).keys()]
    }) as unknown as IDBRequest<IDBValidKey[]>
  }

  count(): IDBRequest<number> {
    return this.tx.enqueue(() => this.tx.readStore(this.name).size)
  }

  openCursor(): IDBRequest<IDBCursorWithValue | null> {
    return this.tx.enqueue(
      () => null
    ) as unknown as IDBRequest<IDBCursorWithValue | null>
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  transaction: FakeTransaction | null = null
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null
}

class FakeIndexedDb {
  database: FakeDatabase | null = null

  open(): IDBOpenDBRequest {
    const request = new FakeOpenRequest()
    queueMicrotask(() => {
      if (!this.database) {
        this.database = new FakeDatabase()
        request.result = this.database
        request.transaction = new FakeTransaction(
          this.database,
          [],
          "versionchange"
        )
        request.onupgradeneeded?.({
          target: request,
          oldVersion: 0,
          newVersion: 4,
        } as unknown as IDBVersionChangeEvent)
      }
      request.result = this.database!
      request.onsuccess?.({ target: request } as unknown as Event)
    })
    return request as unknown as IDBOpenDBRequest
  }
}

function activity(id: string, startedAtMs: number): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs,
    coordinates: [
      [14, 50],
      [14.01, 50.01],
    ],
    format: "gpx",
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
  }
}

const fakeIndexedDb = new FakeIndexedDb()
const originalIndexedDb = globalThis.indexedDB

beforeAll(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: fakeIndexedDb,
  })
})

afterAll(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: originalIndexedDb,
  })
})

beforeEach(async () => {
  await clearActivities()
  fakeIndexedDb.database!.failWrites = false
  fakeIndexedDb.database!.duplicateSummaryRecords = []
  fakeIndexedDb.database!.resetMetrics()
})

describe("activity summary storage recovery", () => {
  test("uses the summary fast path on initial load and reload", async () => {
    const first = activity("first", 100)
    const second = activity("second", 200)
    await saveActivities([first, second])
    fakeIndexedDb.database!.resetMetrics()

    const loaded = await loadActivitySummaries()
    expect(loaded.map((summary) => summary.id)).toEqual(["first", "second"])
    expect(fakeIndexedDb.database!.metrics.activityGetAll).toBe(0)
    expect(fakeIndexedDb.database!.metrics.activityGetAllKeys).toBe(1)

    fakeIndexedDb.database!.resetMetrics()
    await expect(loadActivitySummaries()).resolves.toEqual(loaded)
    expect(fakeIndexedDb.database!.metrics.activityGetAll).toBe(0)
    expect(fakeIndexedDb.database!.metrics.activityGetAllKeys).toBe(1)
  })

  test("repairs an orphan and missing summary when counts still match", async () => {
    const first = activity("first", 100)
    await saveActivities([first])
    const summaries = fakeIndexedDb.database!.raw("activity-summaries")
    summaries.delete("first")
    summaries.set("orphan", activityToSummary(activity("orphan", 200)))

    await expect(loadActivitySummaries()).resolves.toEqual([
      activityToSummary(first),
    ])
    expect([
      ...fakeIndexedDb.database!.raw("activity-summaries").keys(),
    ]).toEqual(["first"])
  })

  test("repairs duplicate and malformed summary records", async () => {
    const first = activity("first", 100)
    const second = activity("second", 200)
    await saveActivities([first, second])
    let summaries = fakeIndexedDb.database!.raw("activity-summaries")
    fakeIndexedDb.database!.duplicateSummaryRecords = [summaries.get("first")]
    await expect(loadActivitySummaries()).resolves.toEqual([
      activityToSummary(first),
      activityToSummary(second),
    ])
    fakeIndexedDb.database!.duplicateSummaryRecords = []
    summaries = fakeIndexedDb.database!.raw("activity-summaries")

    const editedFirst = {
      ...activityToSummary(first),
      name: "edited-first.gpx",
      activityType: "walking" as const,
    }
    summaries.set("first", {
      ...editedFirst,
    })
    summaries.set("second", {
      ...activityToSummary(second),
      stats: { ...activityToSummary(second).stats, distanceKm: "bad" },
    })
    await expect(loadActivitySummaries()).resolves.toEqual([
      editedFirst,
      activityToSummary(second),
    ])
    expect(
      fakeIndexedDb.database!.raw("activity-summaries").get("first")
    ).toEqual(editedFirst)
  })

  test("clears orphan summaries when the activity library is empty", async () => {
    await saveActivities([activity("first", 100)])
    await clearActivities()
    fakeIndexedDb
      .database!.raw("activity-summaries")
      .set("orphan", activityToSummary(activity("orphan", 200)))

    await expect(loadActivitySummaries()).resolves.toEqual([])
    expect(fakeIndexedDb.database!.raw("activity-summaries").size).toBe(0)
  })

  test("returns rebuilt summaries in memory when replacement persistence fails", async () => {
    const first = activity("first", 100)
    await saveActivities([first])
    const summaries = fakeIndexedDb.database!.raw("activity-summaries")
    summaries.delete("first")
    summaries.set("orphan", activityToSummary(activity("orphan", 200)))
    fakeIndexedDb.database!.failWrites = true

    await expect(loadActivitySummaries()).resolves.toEqual([
      activityToSummary(first),
    ])
    expect([...summaries.keys()]).toEqual(["orphan"])
  })

  test("keeps normal activity saves and deletes atomic across both stores", async () => {
    const first = activity("first", 100)
    await saveActivities([first])
    fakeIndexedDb.database!.failWrites = true

    await saveActivities([activity("second", 200)])
    expect([...fakeIndexedDb.database!.raw("activities").keys()]).toEqual([
      "first",
    ])

    await deleteActivity("first")
    expect(fakeIndexedDb.database!.raw("activities").has("first")).toBe(true)
    expect(fakeIndexedDb.database!.raw("activity-summaries").has("first")).toBe(
      true
    )
  })
})
