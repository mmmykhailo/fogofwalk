import { beforeEach, describe, expect, test } from "bun:test"
import {
  classifyTrailTileError,
  recordTrailTileError,
  resetTrailTileDiagnostics,
} from "./diagnostics"
import { clearDiagnostics, getDiagnostics } from "~/lib/diagnostics"

describe("trail tile diagnostics", () => {
  beforeEach(() => {
    resetTrailTileDiagnostics()
    clearDiagnostics()
  })

  test("classifies the bounded tile failure categories", () => {
    expect(classifyTrailTileError(new TypeError("Failed to fetch"))).toBe(
      "network"
    )
    expect(classifyTrailTileError({ status: 500 })).toBe("http")
    expect(classifyTrailTileError(new Error("CORS request blocked"))).toBe(
      "cors"
    )
    expect(classifyTrailTileError(new Error("Vector tile decode failed"))).toBe(
      "decode"
    )
  })

  test("records one coordinate-free diagnostic per error class", () => {
    recordTrailTileError(new Error("Vector tile decode failed for secret URL"))
    recordTrailTileError(new Error("Vector tile decode failed again"))
    recordTrailTileError(new Error("Failed to fetch"))

    expect(getDiagnostics()).toHaveLength(2)
    expect(getDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subsystem: "render",
          operationId: "trail:tiles",
          stage: "trail_tiles",
          result: "degraded",
          errorCode: "trail_tiles_decode",
        }),
        expect.objectContaining({
          errorCode: "trail_tiles_network",
        }),
      ])
    )
    expect(JSON.stringify(getDiagnostics())).not.toContain("secret URL")
  })
})
