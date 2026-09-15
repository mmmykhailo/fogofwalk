import { useEffect, useRef, useState } from "react"
import {
  activityProgressUpdateKey,
  createActivityProgressSession,
  getActivityProgressIdentities,
  getActivityProgressRows,
  getObservedActivityProgressRows,
  isActivityProgressSessionComplete,
  mergeActivityProgressSession,
} from "~/lib/activities/progress"
import type { ActivityProgressRow } from "~/lib/activities/progress"
import {
  dismissImportStatus,
  useImportStatus,
} from "~/lib/activities/import/status"
import { useFogStatus } from "~/lib/mapStore"

const ACTIVITY_PROGRESS_QUIET_MS = 3_000

function isImportTerminal(
  phase: ReturnType<typeof useImportStatus>["phase"]
): boolean {
  return phase !== "idle" && phase !== "running"
}

export function ActivityProgress() {
  const importStatus = useImportStatus()
  const fogStatus = useFogStatus()
  const [, setSessionVersion] = useState(0)
  const sessionRef = useRef(createActivityProgressSession())

  const identities = getActivityProgressIdentities(importStatus, fogStatus)
  const observedRows = getObservedActivityProgressRows(
    importStatus,
    fogStatus,
    sessionRef.current
  )
  const session = mergeActivityProgressSession(
    sessionRef.current,
    observedRows,
    identities
  )
  sessionRef.current = session

  const updateKey = activityProgressUpdateKey(importStatus, fogStatus)
  const currentSessionRef = sessionRef
  const importStatusRef = useRef(importStatus)
  const fogStatusRef = useRef(fogStatus)
  const updateKeyRef = useRef(updateKey)
  importStatusRef.current = importStatus
  fogStatusRef.current = fogStatus
  updateKeyRef.current = updateKey

  useEffect(() => {
    if (
      !isActivityProgressSessionComplete(session) ||
      importStatus.phase === "running" ||
      fogStatus.phase === "processing" ||
      fogStatus.phase === "recovering"
    ) {
      return
    }

    const capturedImportOperationId = session.importOperationId
    const capturedFogRequestId = session.fogRequestId
    const capturedFogGeneration = session.fogGeneration
    const capturedUpdateKey = updateKey
    const timeoutId = window.setTimeout(() => {
      const currentImportStatus = importStatusRef.current
      const currentFogStatus = fogStatusRef.current
      const currentSession = currentSessionRef.current

      if (
        currentSession.importOperationId !== capturedImportOperationId ||
        currentSession.fogRequestId !== capturedFogRequestId ||
        currentSession.fogGeneration !== capturedFogGeneration ||
        updateKeyRef.current !== capturedUpdateKey ||
        !isActivityProgressSessionComplete(currentSession) ||
        currentImportStatus.phase === "running" ||
        currentFogStatus.phase === "processing" ||
        currentFogStatus.phase === "recovering"
      ) {
        return
      }

      currentSessionRef.current = createActivityProgressSession()
      setSessionVersion((version) => version + 1)

      if (
        capturedImportOperationId !== null &&
        currentImportStatus.operationId === capturedImportOperationId &&
        currentImportStatus.isVisible &&
        isImportTerminal(currentImportStatus.phase)
      ) {
        dismissImportStatus(capturedImportOperationId)
      }
    }, ACTIVITY_PROGRESS_QUIET_MS)

    return () => window.clearTimeout(timeoutId)
  }, [fogStatus.phase, importStatus.phase, session, updateKey])

  const rows = getActivityProgressRows(session)
  return <ActivityProgressPanel rows={rows} />
}

export function ActivityProgressPanel({
  rows,
}: {
  rows: readonly ActivityProgressRow[]
}) {
  if (rows.length === 0) return null

  return (
    <div
      data-testid="activity-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="map-moving-blur-fallback flex w-full max-w-[min(28rem,calc(100vw-1.5rem))] border border-border bg-background/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-md"
    >
      <div className="min-w-0 flex-1 space-y-1.5 text-muted-foreground">
        {rows.map((row) => (
          <div
            key={row.stage}
            data-testid="activity-progress-stage"
            data-stage={row.stage}
            className="space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{row.label}</span>
              <span className="shrink-0 tabular-nums">
                {row.current} of {row.maximum}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={row.maximum}
              aria-valuenow={row.current}
              aria-valuetext={`${row.current} of ${row.maximum} ${row.unit}`}
              className="relative h-1 w-full overflow-hidden bg-muted"
            >
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${row.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
