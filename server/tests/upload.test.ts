/**
 * Content hash and body handling — the two things that keep an upload from
 * being trusted blindly.
 */

import { describe, expect, test } from "bun:test"

import {
  BodyTooLargeError,
  gunzipCapped,
  looksGzipped,
  readCappedBody,
} from "../src/activities/body"
import {
  canonicalHashString,
  contentHashMatches,
  computeContentHash,
  isContentHash,
} from "../src/activities/contentHash"
import { parseActivityUpload } from "../src/activities/payload"
import { makeStats, makeActivity, setup, signIn, authHeaders } from "./helpers"

describe("content hash", () => {
  test("uses the canonical form shared with the client", () => {
    expect(
      canonicalHashString({
        format: "gpx",
        startedAtMs: 42,
        coordinates: [
          [1, 2],
          [3.1234567, 4.7654321],
        ],
      })
    ).toBe("gpx|42|2|1.000000,2.000000;3.123457,4.765432")
  })

  test("renders a null start time as an empty field", () => {
    expect(
      canonicalHashString({
        format: "fit",
        startedAtMs: null,
        coordinates: [[0, 0]],
      })
    ).toBe("fit||1|0.000000,0.000000")
  })

  test("is stable, and 64 lowercase hex digits", async () => {
    const hash = await computeContentHash(makeActivity())
    expect(isContentHash(hash)).toBe(true)
    expect(await computeContentHash(makeActivity())).toBe(hash)
  })

  test("ignores name and stats but not geometry, format or start time", async () => {
    const base = makeActivity()
    const hash = await computeContentHash(base)

    const renamed = makeActivity({ name: "Renamed", stats: makeStats(999) })
    expect(await computeContentHash(renamed)).toBe(hash)
    expect(await computeContentHash({ ...base, format: "fit" })).not.toBe(hash)
    expect(await computeContentHash({ ...base, startedAtMs: 1 })).not.toBe(hash)
    expect(
      await computeContentHash({
        ...base,
        coordinates: [...base.coordinates, [13.5, 52.6]],
      })
    ).not.toBe(hash)
  })

  test("ignores differences below the 6-decimal precision", async () => {
    const base = makeActivity()
    const nudged = {
      ...base,
      coordinates: base.coordinates.map(
        ([lng, lat]) => [lng + 1e-9, lat] as [number, number]
      ),
    }
    expect(await computeContentHash(nudged)).toBe(
      await computeContentHash(base)
    )
  })

  test("uses a distinct path-aware identity for disconnected geometry", () => {
    const separated = canonicalHashString({
      format: "gpx",
      startedAtMs: 42,
      paths: [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ],
    })
    const flattened = canonicalHashString({
      format: "gpx",
      startedAtMs: 42,
      paths: [
        [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      ],
    })
    expect(separated).toContain("v2|gpx|42|2|2:")
    expect(separated).not.toBe(flattened)
  })

  test("accepts a legacy single-path hash for a canonical single path", async () => {
    const coordinates = [
      [1, 2],
      [3, 4],
    ] as [number, number][]
    const legacyHash = await computeContentHash({
      format: "gpx",
      startedAtMs: 42,
      coordinates,
    })
    expect(
      await contentHashMatches(
        { format: "gpx", startedAtMs: 42, paths: [coordinates] },
        legacyHash
      )
    ).toBe(true)
  })

  test("accepts a canonical multi-path upload and records all points", async () => {
    const { app, store } = setup()
    const { token, user } = await signIn(store)
    const legacy = makeActivity()
    const { coordinates, pointTimestamps, ...metadata } = legacy
    const payload = {
      ...metadata,
      paths: [coordinates.slice(0, 2), coordinates.slice(1)],
      pathTimestamps: [pointTimestamps!.slice(0, 2), pointTimestamps!.slice(1)],
    }
    const hash = await computeContentHash({
      format: payload.format,
      startedAtMs: payload.startedAtMs,
      paths: payload.paths,
    })
    const response = await app.request(`/api/activities/${hash}`, {
      method: "PUT",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: Bun.gzipSync(new TextEncoder().encode(JSON.stringify(payload))),
    })

    expect(response.status).toBe(200)
    const responseBody = (await response.json()) as { pointCount: number }
    expect(responseBody.pointCount).toBe(4)
    expect((await store.listManifest(user.id, 0)).activities).toHaveLength(1)
  })
})

describe("payload validation", () => {
  test("accepts a well-formed activity", () => {
    expect(parseActivityUpload(makeActivity()).ok).toBe(true)
  })

  test("accepts path-aware payloads and rejects path timestamp drift", () => {
    const { coordinates, pointTimestamps, ...metadata } = makeActivity()
    const payload = {
      ...metadata,
      paths: [coordinates.slice(0, 2), coordinates.slice(1)],
      pathTimestamps: [pointTimestamps!.slice(0, 2), pointTimestamps!.slice(1)],
    }
    expect(parseActivityUpload(payload).ok).toBe(true)
    expect(
      parseActivityUpload({
        ...payload,
        pathTimestamps: [
          pointTimestamps!.slice(0, 1),
          pointTimestamps!.slice(1),
        ],
      })
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("aligned"),
    })
  })

  test("rejects nonsense", () => {
    const cases: unknown[] = [
      null,
      "a string",
      { ...makeActivity(), coordinates: [] },
      { ...makeActivity(), coordinates: [[181, 0]] },
      { ...makeActivity(), coordinates: [[0, 91]] },
      { ...makeActivity(), format: "tcx" },
      { ...makeActivity(), stats: undefined },
      { ...makeActivity(), name: "" },
      { ...makeActivity(), startedAtMs: Number.NaN },
    ]
    for (const value of cases) {
      expect(parseActivityUpload(value).ok).toBe(false)
    }
  })
})

describe("body limits", () => {
  test("rejects a body larger than the cap while reading it", async () => {
    const request = new Request("http://test/upload", {
      method: "PUT",
      body: new Uint8Array(4096),
    })
    await expect(readCappedBody(request, 1024)).rejects.toBeInstanceOf(
      BodyTooLargeError
    )
  })

  test("accepts a body under the cap", async () => {
    const request = new Request("http://test/upload", {
      method: "PUT",
      body: new Uint8Array(100),
    })
    expect((await readCappedBody(request, 1024)).byteLength).toBe(100)
  })

  test("detects gzip by magic number", () => {
    expect(looksGzipped(Bun.gzipSync(new Uint8Array([1, 2, 3])))).toBe(true)
    expect(looksGzipped(new TextEncoder().encode("{}"))).toBe(false)
  })

  test("refuses to inflate a zip bomb past the cap", async () => {
    const bomb = Bun.gzipSync(new Uint8Array(1_000_000))
    expect(bomb.byteLength).toBeLessThan(10_000)
    await expect(gunzipCapped(bomb, 4096)).rejects.toBeInstanceOf(
      BodyTooLargeError
    )
  })

  test("round-trips a normal body", async () => {
    const payload = new TextEncoder().encode(JSON.stringify(makeActivity()))
    const out = await gunzipCapped(Bun.gzipSync(payload))
    expect(new TextDecoder().decode(out)).toBe(
      new TextDecoder().decode(payload)
    )
  })
})
