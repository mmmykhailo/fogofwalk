import type {
  ActivityDraft,
  CanonicalActivity,
  ParsedActivity,
} from "~shared/activities"
import { flattenActivityPaths } from "~shared/activityContract"
import { createUuid } from "~/lib/uuid"
import { parseFile as defaultParseFile } from "~/lib/parsers"
import { normalizeAndHashActivity } from "~/lib/activities/normalize"
import { isActivityStorageError } from "../errors"
import type { DuplicateReason, LibraryCommit } from "../libraryEvents"

export type ImportStage =
  | "queued"
  | "reading"
  | "parsing"
  | "validating"
  | "ready"
  | "committing"
  | "committed"
  | "deriving"
  | "complete"

export type ImportTerminalStatus =
  | "committed"
  | "duplicate"
  | "rejected"
  | "cancelled"
  | "failed"

export interface ImportWarning {
  code: string
  message: string
  path?: string
}

export interface ImportActivityOutcome {
  id: string
  status: ImportTerminalStatus
  contentHash?: string
  reason?: string
}

export interface ImportFileOutcome {
  index: number
  name: string
  stage: ImportStage
  status: ImportTerminalStatus
  parsedActivityCount: number
  activities: ImportActivityOutcome[]
  warnings: ImportWarning[]
  errorCode?: string
  error?: string
}

export interface ImportFailureSummary {
  name: string
  status: Extract<ImportTerminalStatus, "failed" | "rejected" | "cancelled">
  errorCode?: string
  error?: string
}

export interface ImportBatchResult {
  operationId: string
  files: ImportFileOutcome[]
  activities: ImportActivityOutcome[]
  cancelled: boolean
}

export interface ImportProgressEvent {
  operationId: string
  fileIndex: number
  stage: ImportStage
  /** Number of files whose local preparation has finished, not durable commits. */
  completedFiles: number
  totalFiles: number
}

export interface ImportServiceOptions {
  parseFile?: (file: File) => Promise<ParsedActivity[]>
  commit: (
    operationId: string,
    activities: ParsedActivity[]
  ) => Promise<LibraryCommit>
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (event: ImportProgressEvent) => void
}

function safeError(error: unknown): { errorCode: string; error: string } {
  if (isActivityStorageError(error)) {
    return {
      errorCode: `storage-${error.code}`,
      error: error.message,
    }
  }
  if (error instanceof Error) {
    return {
      errorCode: error.name || "parse-failed",
      error: error.message || "The activity file could not be read.",
    }
  }
  return {
    errorCode: "parse-failed",
    error: "The activity file could not be read.",
  }
}

function compatibilityDraft(activity: ParsedActivity): ActivityDraft {
  const {
    coordinates: _coordinates,
    pointTimestamps: _pointTimestamps,
    paths,
    pathTimestamps,
    ...metadata
  } = activity
  if (paths && paths.length > 0) {
    return {
      ...metadata,
      paths,
      ...(pathTimestamps ? { pathTimestamps } : {}),
    }
  }
  return {
    ...metadata,
    coordinates: activity.coordinates,
    ...(activity.pointTimestamps
      ? {
          pointTimestamps: activity.pointTimestamps.map((value) =>
            value < 0 ? null : value
          ),
        }
      : {}),
  }
}

/** Keep a legacy render alias while canonical storage migrates to paths. */
export function toCompatibilityActivity(
  activity: CanonicalActivity
): ParsedActivity & { paths: CanonicalActivity["paths"] } {
  const pointTimestamps = activity.pathTimestamps?.flatMap((path) =>
    path.map((timestamp) => timestamp ?? -1)
  )
  return {
    ...activity,
    coordinates: flattenActivityPaths(activity.paths),
    ...(pointTimestamps ? { pointTimestamps } : {}),
    ...(activity.pathTimestamps
      ? { pathTimestamps: activity.pathTimestamps }
      : {}),
  }
}

function defaultConcurrency(): number {
  if (typeof navigator === "undefined") return 2
  const cores = navigator.hardwareConcurrency || 2
  return cores <= 2 ? 1 : cores <= 4 ? 2 : 3
}

function setStage(
  outcome: ImportFileOutcome,
  stage: ImportStage,
  operationId: string,
  totalFiles: number,
  completedFiles: number,
  onProgress?: (event: ImportProgressEvent) => void
): void {
  outcome.stage = stage
  onProgress?.({
    operationId,
    fileIndex: outcome.index,
    stage,
    completedFiles,
    totalFiles,
  })
}

function isDuplicate(
  activity: ImportActivityOutcome,
  duplicates: DuplicateReason[]
): DuplicateReason | undefined {
  return duplicates.find(
    (duplicate) =>
      duplicate.activityId === activity.id ||
      (activity.contentHash != null &&
        duplicate.contentHash === activity.contentHash)
  )
}

/**
 * Bounded, transport-independent import lifecycle. Parsing failures are kept
 * per file, while one library commit gives the whole accepted batch one
 * operation id and one revision.
 */
export interface ActivityImportService {
  importFiles(
    files: readonly File[],
    operationId?: string
  ): Promise<ImportBatchResult>
}

export function createActivityImportService(
  options: ImportServiceOptions
): ActivityImportService {
  const parse = options.parseFile ?? defaultParseFile

  async function importFiles(
    files: readonly File[],
    operationId = createUuid()
  ): Promise<ImportBatchResult> {
    const outcomes = files.map<ImportFileOutcome>((file, index) => ({
      index,
      name: file.name,
      stage: "queued",
      status: "cancelled",
      parsedActivityCount: 0,
      activities: [],
      warnings: [],
    }))
    const parsedByFile = new Map<number, ParsedActivity[]>()
    let nextIndex = 0
    let completedFiles = 0
    const concurrency = Math.max(
      1,
      Math.min(8, Math.floor(options.concurrency ?? defaultConcurrency()))
    )

    const processOne = async (outcome: ImportFileOutcome): Promise<void> => {
      if (options.signal?.aborted) {
        outcome.status = "cancelled"
        outcome.errorCode = "cancelled"
        outcome.error = "Import cancelled before reading the file."
        setStage(
          outcome,
          "complete",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
        return
      }

      try {
        setStage(
          outcome,
          "reading",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
        setStage(
          outcome,
          "parsing",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
        const parsed = await parse(files[outcome.index]!)
        outcome.parsedActivityCount = parsed.length
        if (parsed.length === 0) {
          outcome.status = "rejected"
          outcome.errorCode = "empty-file"
          outcome.error = "No activities were found in this file."
          return
        }

        setStage(
          outcome,
          "validating",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
        for (const parsedActivity of parsed) {
          const normalized = await normalizeAndHashActivity(
            compatibilityDraft(parsedActivity)
          )
          if (!normalized.ok) {
            outcome.warnings.push(...normalized.warnings)
            outcome.activities.push({
              id: parsedActivity.id,
              status: "rejected",
              reason: normalized.error.message,
            })
            continue
          }
          const activity = toCompatibilityActivity(normalized.activity)
          const accepted = parsedByFile.get(outcome.index) ?? []
          accepted.push(activity)
          parsedByFile.set(outcome.index, accepted)
          outcome.activities.push({
            id: activity.id,
            contentHash: activity.contentHash,
            status: "committed",
          })
          outcome.warnings.push(...normalized.warnings)
        }
        if (outcome.activities.length === 0) {
          outcome.status = "rejected"
          outcome.errorCode = "invalid-activity"
          outcome.error = "No usable activities were found in this file."
        }
      } catch (error) {
        const safe = safeError(error)
        outcome.status = "failed"
        outcome.errorCode = safe.errorCode
        outcome.error = safe.error
      } finally {
        completedFiles++
      }
    }

    const worker = async () => {
      while (true) {
        const index = nextIndex++
        if (index >= files.length) return
        await processOne(outcomes[index]!)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, worker)
    )

    // Parser completion order is intentionally not the commit order. Keeping
    // accepted activities grouped by input index makes the library command
    // deterministic even when files finish parsing at different times.
    const parsedActivities = outcomes.flatMap(
      (outcome) => parsedByFile.get(outcome.index) ?? []
    )

    const cancelled = options.signal?.aborted ?? false
    if (cancelled) {
      for (const outcome of outcomes) {
        if (outcome.status === "committed") {
          outcome.status = "cancelled"
          outcome.activities = outcome.activities.map((activity) => ({
            ...activity,
            status: "cancelled",
          }))
        }
      }
      return {
        operationId,
        files: outcomes,
        activities: outcomes.flatMap((outcome) => outcome.activities),
        cancelled: true,
      }
    }

    if (parsedActivities.length > 0) {
      for (const outcome of outcomes) {
        if (
          outcome.activities.some((activity) => activity.status === "committed")
        ) {
          setStage(
            outcome,
            "committing",
            operationId,
            files.length,
            completedFiles,
            options.onProgress
          )
        }
      }
      let commitResult: LibraryCommit | null = null
      try {
        commitResult = await options.commit(operationId, parsedActivities)
      } catch (error) {
        const safe = safeError(error)
        for (const outcome of outcomes) {
          if (
            !outcome.activities.some(
              (activity) => activity.status === "committed"
            )
          )
            continue
          outcome.status = "failed"
          outcome.errorCode = safe.errorCode
          outcome.error = safe.error
          outcome.activities = outcome.activities.map((activity) =>
            activity.status === "committed"
              ? { ...activity, status: "failed", reason: safe.error }
              : activity
          )
        }
      }

      if (commitResult) {
        const duplicateMap = commitResult.change.duplicates
        for (const outcome of outcomes) {
          const accepted = outcome.activities.filter(
            (activity) => activity.status === "committed"
          )
          if (accepted.length === 0) continue
          outcome.activities = outcome.activities.map((activity) => {
            const duplicate = isDuplicate(activity, duplicateMap)
            return duplicate
              ? {
                  ...activity,
                  status: "duplicate",
                  reason: duplicate.reason,
                }
              : activity
          })
          const hasCommitted = outcome.activities.some(
            (activity) => activity.status === "committed"
          )
          outcome.status = hasCommitted ? "committed" : "duplicate"
        }
      }
    }

    for (const outcome of outcomes) {
      if (outcome.status === "cancelled") outcome.status = "rejected"
      if (outcome.status === "committed" || outcome.status === "duplicate") {
        setStage(
          outcome,
          "committed",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
        setStage(
          outcome,
          "deriving",
          operationId,
          files.length,
          completedFiles,
          options.onProgress
        )
      }
      setStage(
        outcome,
        "complete",
        operationId,
        files.length,
        completedFiles,
        options.onProgress
      )
    }

    return {
      operationId,
      files: outcomes,
      activities: outcomes.flatMap((outcome) => outcome.activities),
      cancelled: false,
    }
  }

  return { importFiles }
}
