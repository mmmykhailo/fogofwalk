import { beforeEach, describe, expect, test } from "bun:test"
import {
  classifyTrailArchiveError,
  recordTrailArchiveError,
  resetTrailArchiveDiagnostics,
} from "./diagnostics"
import { clearDiagnostics, getDiagnostics } from "~/lib/diagnostics"

describe("trail archive diagnostics", () => {
  beforeEach(() => {
    resetTrailArchiveDiagnostics()
    clearDiagnostics()
  })

  test("classifies the bounded archive failure categories", () => {
    expect(classifyTrailArchiveError(new TypeError("Failed to fetch"))).toBe(
      "network"
    )
    expect(classifyTrailArchiveError({ status: 500 })).toBe("http")
    expect(classifyTrailArchiveError(new Error("CORS request blocked"))).toBe(
      "cors"
    )
    expect(
      classifyTrailArchiveError(new Error("missing Content-Range response"))
    ).toBe("range")
    expect(classifyTrailArchiveError(new Error("PMTiles decode failed"))).toBe(
      "decode"
    )
  })

  test("records one coordinate-free diagnostic per error class", () => {
    recordTrailArchiveError(new Error("PMTiles decode failed for secret URL"))
    recordTrailArchiveError(new Error("PMTiles decode failed again"))
    recordTrailArchiveError(new Error("Failed to fetch"))

    expect(getDiagnostics()).toHaveLength(2)
    expect(getDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subsystem: "render",
          operationId: "trail:archive",
          stage: "trail_archive",
          result: "degraded",
          errorCode: "trail_archive_decode",
        }),
        expect.objectContaining({
          errorCode: "trail_archive_network",
        }),
      ])
    )
    expect(JSON.stringify(getDiagnostics())).not.toContain("secret URL")
  })
})
