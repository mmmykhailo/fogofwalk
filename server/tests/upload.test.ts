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
} from "../src/tracks/body"
import {
  canonicalHashString,
  computeContentHash,
  isContentHash,
} from "../src/tracks/contentHash"
import { parseTrackUpload } from "../src/tracks/payload"
import { makeStats, makeTrack } from "./helpers"

describe("content hash", () => {
  test("uses the canonical form from plan §4", () => {
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
    const hash = await computeContentHash(makeTrack())
    expect(isContentHash(hash)).toBe(true)
    expect(await computeContentHash(makeTrack())).toBe(hash)
  })

  test("ignores name and stats but not geometry, format or start time", async () => {
    const base = makeTrack()
    const hash = await computeContentHash(base)

    const renamed = makeTrack({ name: "Renamed", stats: makeStats(999) })
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
    const base = makeTrack()
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
})

describe("payload validation", () => {
  test("accepts a well-formed track", () => {
    expect(parseTrackUpload(makeTrack()).ok).toBe(true)
  })

  test("rejects nonsense", () => {
    const cases: unknown[] = [
      null,
      "a string",
      { ...makeTrack(), coordinates: [] },
      { ...makeTrack(), coordinates: [[181, 0]] },
      { ...makeTrack(), coordinates: [[0, 91]] },
      { ...makeTrack(), format: "tcx" },
      { ...makeTrack(), stats: undefined },
      { ...makeTrack(), name: "" },
      { ...makeTrack(), startedAtMs: Number.NaN },
    ]
    for (const value of cases) {
      expect(parseTrackUpload(value).ok).toBe(false)
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
    const payload = new TextEncoder().encode(JSON.stringify(makeTrack()))
    const out = await gunzipCapped(Bun.gzipSync(payload))
    expect(new TextDecoder().decode(out)).toBe(
      new TextDecoder().decode(payload)
    )
  })
})
