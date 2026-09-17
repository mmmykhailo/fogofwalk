import { describe, expect, test } from "bun:test"
import { validateTrailArchiveUrl } from "~/lib/map/trails/config"

describe("trail archive configuration", () => {
  test("treats blank values as unavailable", () => {
    expect(validateTrailArchiveUrl(undefined)).toBeNull()
    expect(validateTrailArchiveUrl("  ")).toBeNull()
  })

  test("accepts absolute HTTPS PMTiles URLs", () => {
    expect(
      validateTrailArchiveUrl(
        "https://api.example.test/map-data/trails/v1/archive.pmtiles"
      )
    ).toBe("https://api.example.test/map-data/trails/v1/archive.pmtiles")
  })

  test("accepts HTTP only for loopback fixture servers", () => {
    expect(
      validateTrailArchiveUrl("http://127.0.0.1:4173/trails-v1.pmtiles")
    ).toBe("http://127.0.0.1:4173/trails-v1.pmtiles")
    expect(validateTrailArchiveUrl("http://[::1]:4173/trails-v1.pmtiles")).toBe(
      "http://[::1]:4173/trails-v1.pmtiles"
    )
    expect(validateTrailArchiveUrl("http://example.test/trails.pmtiles")).toBe(
      null
    )
  })

  test("rejects credentials, queries, fragments, and unsafe schemes", () => {
    for (const value of [
      "https://user:password@example.test/trails.pmtiles",
      "https://example.test/trails.pmtiles?token=secret",
      "https://example.test/trails.pmtiles#section",
      "file:///tmp/trails.pmtiles",
      "javascript:alert(1)",
      "/map-data/trails.pmtiles",
      "https://example.test/not-an-archive.bin",
    ]) {
      expect(validateTrailArchiveUrl(value)).toBeNull()
    }
  })
})
