import { describe, expect, test } from "bun:test"
import type { ImportStatus } from "./import/status"
import {
  activityProgressUpdateKey,
  createActivityProgressSession,
  getActivityProgressIdentities,
  getActivityProgressRows,
  getObservedActivityProgressRows,
  isActivityProgressSessionComplete,
  mergeActivityProgressSession,
} from "./progress"
import type { FogProjectionStatus } from "~/lib/mapStore"

function importStatus(overrides: Partial<ImportStatus> = {}): ImportStatus {
  return {
    phase: "running",
    operationId: "import-1",
    completedFiles: 0,
    totalFiles: 3,
    fileStages: {},
    isSaveStageVisible: false,
    savedFileIndexes: {},
    isVisible: true,
    result: null,
    error: null,
    ...overrides,
  }
}

function fogStatus(
  overrides: Partial<FogProjectionStatus> = {}
): FogProjectionStatus {
  return {
    phase: "idle",
    requestId: null,
    generation: 1,
    libraryRevision: 1,
    coverageRevision: 1,
    mode: "corridor",
    processed: 0,
    total: 0,
    error: null,
    warnings: [],
    recoveryAttempts: 0,
    retryable: false,
    warningCounts: {},
    errorCounts: {},
    infoCounts: {},
    coverageReducedCounts: {},
    normalizedActivityCount: 0,
    coverageReducedActivityCount: 0,
    repairedActivityCount: 0,
    rejectedActivityCount: 0,
    geometryFallbackCount: 0,
    ...overrides,
  }
}

function merge(
  session: ReturnType<typeof createActivityProgressSession>,
  currentImport: ImportStatus,
  currentFog: FogProjectionStatus
) {
  return mergeActivityProgressSession(
    session,
    getObservedActivityProgressRows(currentImport, currentFog, session),
    getActivityProgressIdentities(currentImport, currentFog)
  )
}

describe("activity progress session", () => {
  test("immediately creates the parsing row at zero", () => {
    const session = merge(
      createActivityProgressSession(),
      importStatus(),
      fogStatus()
    )

    expect(getActivityProgressRows(session)).toMatchObject([
      {
        stage: "parsing",
        label: "Parsing activities",
        current: 0,
        maximum: 3,
        unit: "files",
        percentage: 0,
      },
    ])
  })

  test("adds saving without removing completed parsing", () => {
    const currentImport = importStatus({
      phase: "complete",
      completedFiles: 3,
      isSaveStageVisible: true,
      savedFileIndexes: { 0: true, 1: true, 2: true },
    })
    const session = merge(
      merge(createActivityProgressSession(), importStatus(), fogStatus()),
      currentImport,
      fogStatus()
    )

    expect(getActivityProgressRows(session).map((row) => row.stage)).toEqual([
      "parsing",
      "saved",
    ])
    expect(getActivityProgressRows(session)).toMatchObject([
      { current: 3, maximum: 3 },
      { current: 3, maximum: 3 },
    ])
  })

  test("adds fog without removing import rows", () => {
    const importSnapshot = importStatus({
      phase: "complete",
      completedFiles: 3,
      isSaveStageVisible: true,
      savedFileIndexes: { 0: true, 1: true, 2: true },
    })
    const importSession = merge(
      createActivityProgressSession(),
      importSnapshot,
      fogStatus()
    )
    const session = merge(
      importSession,
      importSnapshot,
      fogStatus({
        phase: "processing",
        requestId: "fog-1",
        processed: 1,
        total: 8,
      })
    )

    expect(getActivityProgressRows(session).map((row) => row.stage)).toEqual([
      "parsing",
      "saved",
      "fog",
    ])
  })

  test("retains a row when a later source projection omits it", () => {
    const initialImport = importStatus({
      phase: "running",
      isSaveStageVisible: true,
      savedFileIndexes: { 0: true },
      completedFiles: 1,
    })
    const first = merge(
      createActivityProgressSession(),
      initialImport,
      fogStatus()
    )
    const second = merge(
      first,
      importStatus({ isSaveStageVisible: false, completedFiles: 2 }),
      fogStatus()
    )

    expect(getActivityProgressRows(second).map((row) => row.stage)).toEqual([
      "parsing",
      "saved",
    ])
    expect(second.rows.saved).toMatchObject({ current: 1, maximum: 3 })
  })

  test("always renders fixed order even when fog is observed first", () => {
    const fogFirst = merge(
      createActivityProgressSession(),
      importStatus({ isVisible: false }),
      fogStatus({
        phase: "processing",
        requestId: "fog-1",
        processed: 0,
        total: 2,
      })
    )
    const allRows = merge(
      fogFirst,
      importStatus({ isSaveStageVisible: true, savedFileIndexes: { 0: true } }),
      fogStatus({
        phase: "processing",
        requestId: "fog-1",
        processed: 1,
        total: 2,
      })
    )

    expect(getActivityProgressRows(allRows).map((row) => row.stage)).toEqual([
      "parsing",
      "saved",
      "fog",
    ])
  })

  test("replaces import slots for a new operation and changes identity", () => {
    const firstImport = importStatus({
      phase: "complete",
      completedFiles: 3,
      isSaveStageVisible: true,
      savedFileIndexes: { 0: true, 1: true, 2: true },
    })
    const first = merge(
      createActivityProgressSession(),
      firstImport,
      fogStatus()
    )
    const replacement = merge(
      first,
      importStatus({ operationId: "import-2", totalFiles: 2 }),
      fogStatus()
    )

    expect(getActivityProgressRows(replacement)).toMatchObject([
      { stage: "parsing", current: 0, maximum: 2 },
    ])
    expect(replacement.rows.saved).toBeUndefined()
    expect(replacement.importOperationId).toBe("import-2")
  })

  test("resets fog to zero for a new request", () => {
    const first = merge(
      createActivityProgressSession(),
      importStatus({ isVisible: false }),
      fogStatus({
        phase: "processing",
        requestId: "fog-1",
        processed: 4,
        total: 4,
      })
    )
    const replacement = merge(
      first,
      importStatus({ isVisible: false }),
      fogStatus({
        phase: "processing",
        requestId: "fog-2",
        processed: 0,
        total: 9,
      })
    )

    expect(replacement.rows.fog).toMatchObject({
      current: 0,
      maximum: 9,
    })
    expect(replacement.fogRequestId).toBe("fog-2")
  })

  test("starts a fog-only display session after a dismissed import", () => {
    const imported = merge(
      createActivityProgressSession(),
      importStatus({
        phase: "complete",
        completedFiles: 3,
        isSaveStageVisible: true,
        savedFileIndexes: { 0: true, 1: true, 2: true },
      }),
      fogStatus()
    )
    const rebuilt = merge(
      imported,
      importStatus({ phase: "complete", isVisible: false }),
      fogStatus({
        phase: "processing",
        requestId: "fog-2",
        processed: 0,
        total: 3,
      })
    )

    expect(getActivityProgressRows(rebuilt).map((row) => row.stage)).toEqual([
      "fog",
    ])
  })

  test("only considers positive, fully complete rows complete", () => {
    const empty = createActivityProgressSession()
    expect(isActivityProgressSessionComplete(empty)).toBe(false)

    const zeroMaximum = mergeActivityProgressSession(
      empty,
      [
        {
          stage: "parsing",
          label: "Parsing activities",
          current: 0,
          maximum: 0,
          unit: "files",
          percentage: 0,
        },
      ],
      { importOperationId: "import-1", fogRequestId: null, fogGeneration: 1 }
    )
    expect(isActivityProgressSessionComplete(zeroMaximum)).toBe(false)

    const incomplete = merge(
      createActivityProgressSession(),
      importStatus({ completedFiles: 2 }),
      fogStatus()
    )
    expect(isActivityProgressSessionComplete(incomplete)).toBe(false)

    const complete = merge(
      createActivityProgressSession(),
      importStatus({ phase: "complete", completedFiles: 3 }),
      fogStatus()
    )
    expect(isActivityProgressSessionComplete(complete)).toBe(true)
  })

  test("ignores warning-only changes but includes progress identity changes", () => {
    const baseImport = importStatus()
    const baseFog = fogStatus({
      phase: "processing",
      requestId: "fog-1",
      processed: 1,
      total: 3,
    })
    const baseKey = activityProgressUpdateKey(baseImport, baseFog)

    expect(
      activityProgressUpdateKey(
        baseImport,
        fogStatus({
          ...baseFog,
          warnings: ["warning"],
          warningCounts: { warning: 1 },
        })
      )
    ).toBe(baseKey)
    expect(
      activityProgressUpdateKey(
        baseImport,
        fogStatus({ ...baseFog, phase: "idle" })
      )
    ).not.toBe(baseKey)
    expect(
      activityProgressUpdateKey(
        baseImport,
        fogStatus({ ...baseFog, requestId: "fog-2" })
      )
    ).not.toBe(baseKey)
    expect(
      activityProgressUpdateKey(importStatus({ completedFiles: 1 }), baseFog)
    ).not.toBe(baseKey)
  })

  test("keeps incomplete partial imports visible while allowing all-rejected parsing to complete", () => {
    const partial = merge(
      createActivityProgressSession(),
      importStatus({
        phase: "partial",
        completedFiles: 3,
        isSaveStageVisible: true,
        savedFileIndexes: { 0: true, 1: true },
      }),
      fogStatus()
    )
    expect(isActivityProgressSessionComplete(partial)).toBe(false)

    const allRejected = merge(
      createActivityProgressSession(),
      importStatus({ phase: "failed", completedFiles: 3 }),
      fogStatus()
    )
    expect(isActivityProgressSessionComplete(allRejected)).toBe(true)
  })
})
