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

  test("classifies every bounded tile failure category", () => {
    expect(classifyTrailTileError(new TypeError("Failed to fetch"))).toBe(
      "network"
    )
    expect(classifyTrailTileError({ status: 500 })).toBe("http")
    expect(classifyTrailTileError({ error: { statusCode: 503 } })).toBe("http")
    expect(classifyTrailTileError(new Error("CORS request blocked"))).toBe(
      "cors"
    )
    expect(classifyTrailTileError(new Error("Vector tile decode failed"))).toBe(
      "decode"
    )
    expect(classifyTrailTileError(new Error("unexpected map failure"))).toBe(
      "unknown"
    )
  })

  test("records one coordinate-free diagnostic per error class", () => {
    const failures = [
      [
        "network",
        new Error("Failed to fetch https://secret.example/12/1/2"),
        "retryable",
      ],
      [
        "http",
        { status: 503, url: "https://secret.example/12/1/2" },
        "retryable",
      ],
      ["cors", new Error("CORS blocked at 14.42,50.08"), "retryable"],
      ["decode", new Error("Vector tile decode failed for z/x/y"), "permanent"],
      ["unknown", new Error("unexpected failure with coordinates"), "unknown"],
    ] as const

    for (const [, failure] of failures) recordTrailTileError(failure)
    for (const [, failure] of failures) recordTrailTileError(failure)

    expect(getDiagnostics()).toHaveLength(failures.length)
    expect(getDiagnostics()).toEqual(
      failures.map(([errorClass, , retryability]) =>
        expect.objectContaining({
          subsystem: "render",
          operationId: "trail:tiles",
          stage: "trail_tiles",
          result: "degraded",
          errorCode: `trail_tiles_${errorClass}`,
          retryability,
        })
      )
    )
    const serialized = JSON.stringify(getDiagnostics())
    expect(serialized).not.toContain("secret.example")
    expect(serialized).not.toContain("14.42")
    expect(serialized).not.toContain("z/x/y")
  })

  test("keeps transient HTTP failures retryable and client failures permanent", () => {
    for (const status of [408, 429, 500, 503]) {
      resetTrailTileDiagnostics()
      clearDiagnostics()
      recordTrailTileError({ status })
      expect(getDiagnostics()[0]).toMatchObject({
        errorCode: "trail_tiles_http",
        retryability: "retryable",
      })
    }

    resetTrailTileDiagnostics()
    clearDiagnostics()
    recordTrailTileError({ status: 404 })
    expect(getDiagnostics()[0]).toMatchObject({
      errorCode: "trail_tiles_http",
      retryability: "permanent",
    })
  })
})
