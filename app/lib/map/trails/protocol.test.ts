import { beforeEach, describe, expect, test, vi } from "bun:test"
import { VectorTile } from "@mapbox/vector-tile"
import Pbf from "pbf"
import maplibregl from "maplibre-gl"
import {
  TRAIL_DATA_ZOOM,
  TRAIL_MAX_COORDINATES_PER_FEATURE,
  TRAIL_MAX_RESPONSE_BYTES,
  TRAIL_SOURCE_LAYER,
  TRAIL_FETCH_TIMEOUT_MS,
} from "~/constants/trails"
import { clearDiagnostics, getDiagnostics } from "~/lib/diagnostics"
import hikingKct from "~/lib/map/trails/fixtures/hiking-kct.json"
import * as trailEncoder from "~/lib/map/trails/encode"
import {
  loadTrailTile,
  parseTrailProtocolUrl,
  providerUrlForTrailTile,
  registerTrailProtocol,
  unregisterTrailProtocolForTests,
} from "~/lib/map/trails/protocol"
import type { TrailTileCoordinate } from "~/lib/map/trails/types"

const originalFetch = globalThis.fetch

function emptyTileFeatureCount(data: ArrayBuffer): number {
  return new VectorTile(new Pbf(data)).layers[TRAIL_SOURCE_LAYER]?.length ?? 0
}

function response(
  body: BodyInit,
  status = 200,
  headers?: HeadersInit
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function trailRequest(theme: "hiking" | "cycling" = "hiking") {
  return { url: `fow-trails://${theme}/${TRAIL_DATA_ZOOM}/2212/1387` }
}

beforeEach(() => {
  unregisterTrailProtocolForTests()
  clearDiagnostics()
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})

describe("trail protocol URL parsing", () => {
  test("accepts only fixed-z12 tile coordinates for known themes", () => {
    expect(parseTrailProtocolUrl("fow-trails://hiking/12/2212/1387")).toEqual({
      theme: "hiking",
      z: 12,
      x: 2212,
      y: 1387,
    })
    expect(parseTrailProtocolUrl("fow-trails://cycling/12/0/0")).toEqual({
      theme: "cycling",
      z: 12,
      x: 0,
      y: 0,
    })
  })

  test("rejects invalid theme, zoom, coordinates, and URL decorations", () => {
    const invalidUrls = [
      "fow-trails://walking/12/1/1",
      "fow-trails://hiking/11/1/1",
      "fow-trails://hiking/13/1/1",
      "fow-trails://hiking/12/-1/1",
      "fow-trails://hiking/12/4096/1",
      "fow-trails://hiking/12/1/4096",
      "fow-trails://hiking/12.0/1/1",
      "fow-trails://hiking/12/1.5/1",
      "fow-trails://hiking/12/1/1/extra",
      "fow-trails://hiking/12/1/1?x=1",
      "fow-trails://hiking/12/1/1#fragment",
      "fow-trails://user@hiking/12/1/1",
      "fow-trails://hiking:443/12/1/1",
    ]
    for (const url of invalidUrls) expect(parseTrailProtocolUrl(url)).toBeNull()
  })
})

describe("trail protocol loading", () => {
  test("builds allowlisted provider URLs", () => {
    const tile: TrailTileCoordinate = {
      theme: "hiking",
      z: 12,
      x: 2212,
      y: 1387,
    }
    expect(providerUrlForTrailTile(tile)).toBe(
      "https://hiking.waymarkedtrails.org/api/v1/tiles/12/2212/1387.json"
    )
  })

  test("does not fetch invalid protocol URLs and returns a valid empty tile", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    for (const url of [
      "fow-trails://hiking/11/1/1",
      "fow-trails://hiking/12/1/1?bad=1",
      "fow-trails://invalid/12/1/1",
    ]) {
      const result = await loadTrailTile({ url }, new AbortController())
      expect(emptyTileFeatureCount(result.data)).toBe(0)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getDiagnostics()).toHaveLength(1)
    expect(getDiagnostics()[0]).toMatchObject({
      operationId: "trail:protocol",
      errorCode: "invalid_protocol_url",
    })
  })

  test("fetches only the exact provider URL with CORS-safe options", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(response(JSON.stringify(hikingKct)))

    const result = await loadTrailTile(trailRequest(), new AbortController())

    expect(emptyTileFeatureCount(result.data)).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "https://hiking.waymarkedtrails.org/api/v1/tiles/12/2212/1387.json"
    )
    expect(init).toMatchObject({ credentials: "omit", mode: "cors" })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test("returns an empty tile and one bounded diagnostic for HTTP and body failures", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const failures: [string, Response][] = [
      ["http_error", response("busy", 429)],
      ["invalid_json", response("not-json")],
      ["invalid_collection", response(JSON.stringify({ type: "Thing" }))],
    ]

    for (const [, failedResponse] of failures) {
      fetchMock.mockResolvedValueOnce(failedResponse)
    }

    for (const [code] of failures) {
      const result = await loadTrailTile(trailRequest(), new AbortController())
      expect(emptyTileFeatureCount(result.data)).toBe(0)
      expect(code).toBeTruthy()
    }

    expect(getDiagnostics().map((event) => event.errorCode)).toEqual([
      "http_error",
      "invalid_json",
      "invalid_collection",
    ])
    expect(JSON.stringify(getDiagnostics())).not.toContain(
      "hiking.waymarkedtrails"
    )
  })

  test("enforces declared and actual payload byte limits before parsing", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      response("{}", 200, {
        "content-length": String(TRAIL_MAX_RESPONSE_BYTES + 1),
      })
    )
    fetchMock.mockResolvedValueOnce(
      response(new Uint8Array(TRAIL_MAX_RESPONSE_BYTES + 1))
    )

    expect(
      emptyTileFeatureCount(
        (await loadTrailTile(trailRequest(), new AbortController())).data
      )
    ).toBe(0)
    expect(
      emptyTileFeatureCount(
        (await loadTrailTile(trailRequest("cycling"), new AbortController()))
          .data
      )
    ).toBe(0)
    expect(getDiagnostics().map((event) => event.errorCode)).toEqual([
      "payload_too_large",
      "payload_too_large",
    ])
  })

  test("turns coordinate-budget overflow into an empty tile", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { type: "way" },
              geometry: {
                type: "LineString",
                coordinates: Array.from(
                  { length: TRAIL_MAX_COORDINATES_PER_FEATURE + 1 },
                  () => [0, 0]
                ),
              },
            },
          ],
        })
      )
    )

    const result = await loadTrailTile(trailRequest(), new AbortController())
    expect(emptyTileFeatureCount(result.data)).toBe(0)
    expect(getDiagnostics()[0]).toMatchObject({
      errorCode: "limit_exceeded",
      geometry: { vertexCount: TRAIL_MAX_COORDINATES_PER_FEATURE + 1 },
    })
  })

  test("turns encoder failures into an empty tile", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(response(JSON.stringify(hikingKct)))
    const encodeSpy = vi
      .spyOn(trailEncoder, "encodeTrailTile")
      .mockImplementation(() => {
        throw new Error("synthetic encoder failure")
      })

    try {
      const result = await loadTrailTile(trailRequest(), new AbortController())
      expect(emptyTileFeatureCount(result.data)).toBe(0)
      expect(getDiagnostics()[0]).toMatchObject({
        errorCode: "encode_failed",
        retryability: "unknown",
      })
    } finally {
      encodeSpy.mockRestore()
    }
  })

  test("deduplicates diagnostics by operation and error code", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(() => Promise.resolve(response("nope")))

    await loadTrailTile(trailRequest(), new AbortController())
    await loadTrailTile(trailRequest(), new AbortController())
    await loadTrailTile(trailRequest("cycling"), new AbortController())

    expect(getDiagnostics().map((event) => event.operationId)).toEqual([
      "trail:hiking",
      "trail:cycling",
    ])
  })

  test("rethrows MapLibre aborts without diagnostics", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          })
        })
    )
    const controller = new AbortController()
    const pending = loadTrailTile(trailRequest(), controller)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(getDiagnostics()).toHaveLength(0)
  })

  test("returns an empty tile after the local timeout", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("timed out")
              error.name = "AbortError"
              reject(error)
            })
          })
      )

      const pending = loadTrailTile(trailRequest(), new AbortController())
      await Promise.resolve()
      vi.advanceTimersByTime(TRAIL_FETCH_TIMEOUT_MS)
      const result = await pending

      expect(emptyTileFeatureCount(result.data)).toBe(0)
      expect(getDiagnostics()[0]).toMatchObject({ errorCode: "timeout" })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("trail protocol registration", () => {
  test("registers once and test cleanup permits a fresh registration", () => {
    const addCalls: unknown[][] = []
    const removeCalls: unknown[] = []
    const originalAddProtocol = maplibregl.addProtocol
    const originalRemoveProtocol = maplibregl.removeProtocol
    maplibregl.addProtocol = ((...args: unknown[]) => {
      addCalls.push(args)
    }) as typeof maplibregl.addProtocol
    maplibregl.removeProtocol = ((...args: unknown[]) => {
      removeCalls.push(args[0])
    }) as typeof maplibregl.removeProtocol

    try {
      registerTrailProtocol()
      registerTrailProtocol()
      expect(addCalls).toHaveLength(1)

      unregisterTrailProtocolForTests()
      expect(removeCalls).toEqual(["fow-trails"])

      registerTrailProtocol()
      expect(addCalls).toHaveLength(2)
    } finally {
      unregisterTrailProtocolForTests()
      maplibregl.addProtocol = originalAddProtocol
      maplibregl.removeProtocol = originalRemoveProtocol
    }
  })
})
