import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearDiagnostics,
  exportDiagnostics,
  getDiagnostics,
  MAX_DIAGNOSTIC_EVENTS,
  recordDiagnostic,
  serializeDiagnostics,
} from "./diagnostics"

describe("local diagnostics", () => {
  beforeEach(() => clearDiagnostics())

  test("keeps a bounded ring of scalar, privacy-safe events", () => {
    for (let index = 0; index < MAX_DIAGNOSTIC_EVENTS + 3; index += 1) {
      recordDiagnostic({
        timestamp: index,
        subsystem: "import",
        operationId: `operation-${index}`,
        stage: "parsing",
        result: "progress",
        itemCount: index,
        pointCount: index * 2,
        geometry: { vertexCount: index },
      })
    }

    expect(getDiagnostics()).toHaveLength(MAX_DIAGNOSTIC_EVENTS)
    expect(getDiagnostics()[0]?.timestamp).toBe(3)
    expect(getDiagnostics().at(-1)?.pointCount).toBe(
      (MAX_DIAGNOSTIC_EVENTS + 2) * 2
    )
  })

  test("does not retain payload-like fields or unsafe error text", () => {
    const unsafeInput = {
      subsystem: "sync",
      operationId: "run-1",
      stage: "request",
      result: "failed",
      errorCode: "network-failed",
      retryability: "retryable",
      coordinates: [[14.6, 50.2]],
      fileName: "private-route.fit",
      responseBody: "{" + '"token":"secret"' + "}",
    } as Parameters<typeof recordDiagnostic>[0]
    recordDiagnostic(unsafeInput)

    const exported = exportDiagnostics(123)
    expect(exported).toEqual({
      schemaVersion: 3,
      exportedAt: 123,
      events: [
        expect.objectContaining({
          subsystem: "sync",
          operationId: "run-1",
          errorCode: "network-failed",
          geometry: null,
        }),
      ],
    })
    expect(serializeDiagnostics(123)).not.toContain("private-route.fit")
    expect(serializeDiagnostics(123)).not.toContain("token")
    expect(serializeDiagnostics(123)).not.toContain("coordinates")
  })

  test("normalizes invalid scalar values and notifies through a stable snapshot", () => {
    const first = getDiagnostics()
    recordDiagnostic({
      subsystem: "fog",
      operationId: "bad operation id",
      stage: "bad stage/message",
      result: "degraded",
      durationMs: Number.POSITIVE_INFINITY,
      itemCount: -4,
      libraryRevision: -1,
      errorCode: "worker failed: private route",
      geometry: { inputPoints: 4.8, outputPoints: Number.NaN },
    })

    const current = getDiagnostics()
    expect(current).not.toBe(first)
    expect(current[0]).toMatchObject({
      operationId: "unknown",
      stage: "unknown",
      durationMs: null,
      itemCount: 0,
      libraryRevision: null,
      errorCode: "unknown",
      geometry: { inputPoints: 4 },
    })
  })

  test("keeps bounded warning and fallback counts", () => {
    recordDiagnostic({
      subsystem: "fog",
      stage: "complete",
      result: "partial",
      warningCounts: {
        dropped_path: 2.8,
        "unsafe warning": 4,
      },
      errorCounts: { "activity:no_usable_paths": 3 },
      repairedActivityCount: 1,
      rejectedActivityCount: 2,
      geometryFallbackCount: 1,
    })

    expect(getDiagnostics()[0]).toMatchObject({
      warningCounts: { dropped_path: 2 },
      errorCounts: { "activity:no_usable_paths": 3 },
      repairedActivityCount: 1,
      rejectedActivityCount: 2,
      geometryFallbackCount: 1,
    })
  })
})
