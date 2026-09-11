import { useCallback, useRef, useState } from "react"
import type { ParsedActivity } from "~/types/activities"
import { canSync } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"
import { requestSync } from "~/lib/server/syncEngine"
import { createActivityUploadOutboxItem } from "~/lib/server/sync/activityEffects"
import { activityLibrary, initializeActivityLibrary } from "~/lib/mapStore"
import { createUuid } from "~/lib/uuid"

const SAVE_DELAY_MS = 600

interface UseActivityVisibilityResult {
  isLoading: boolean
  pendingValue: boolean | null
  change: (activity: ParsedActivity, isPublic: boolean) => void
}

/**
 * Debounced public/private toggle for a single activity. Optimistically updates
 * the local activity object and queues the full content-addressed upload after
 * the canonical library commit; rapid toggles coalesce before that commit.
 *
 * No-ops when the user is not signed in for sync or the activity has no content
 * hash (and therefore no server row to update).
 */
export function useActivityVisibility(
  onUpdated?: (activityId: string, isPublic: boolean) => void
): UseActivityVisibilityResult {
  const [isLoading, setIsLoading] = useState(false)
  const [pendingValue, setPendingValue] = useState<boolean | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<{
    activity: ParsedActivity
    isPublic: boolean
  } | null>(null)

  const change = useCallback(
    (activity: ParsedActivity, isPublic: boolean) => {
      if (!canSync() || !activity.contentHash) return

      latestRef.current = { activity, isPublic }
      setPendingValue(isPublic)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(async () => {
        const current = latestRef.current
        if (!current) return

        setIsLoading(true)
        try {
          await initializeActivityLibrary()
          const canonical = activityLibrary
            .getSnapshot()
            .activities.find((item) => item.id === current.activity.id)
          if (!canonical?.contentHash) return
          const operationId = createUuid()
          const updated = { ...canonical, isPublic: current.isPublic }
          const result = await activityLibrary.dispatch(
            {
              type: "applyRemote",
              operationId,
              changes: [{ type: "upsert", activity: updated }],
            },
            {
              outbox: isServerEnabled
                ? (commit) =>
                    commit.change.updated.flatMap((nextActivity) => {
                      const item = createActivityUploadOutboxItem(
                        nextActivity,
                        operationId,
                        commit.snapshot.revision
                      )
                      return item ? [item] : []
                    })
                : [],
            }
          )
          requestSync("activity-visibility-update")
          onUpdated?.(
            result.change.updated[0]?.id ?? canonical.id,
            current.isPublic
          )
        } catch (err) {
          console.warn("[visibility] failed to save:", err)
        } finally {
          setIsLoading(false)
          setPendingValue(null)
          latestRef.current = null
        }
      }, SAVE_DELAY_MS)
    },
    [onUpdated]
  )

  return { isLoading, pendingValue, change }
}
