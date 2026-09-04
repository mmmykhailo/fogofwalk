import { useCallback, useRef, useState } from "react"
import type { ParsedActivity } from "~/types/activities"
import { updateActivityVisibility } from "~/lib/server/activityVisibility"
import { canSync } from "~/lib/server/authStore"
import { updateActivityMetadata } from "~/lib/storage"

const SAVE_DELAY_MS = 600

interface UseActivityVisibilityResult {
  isLoading: boolean
  pendingValue: boolean | null
  change: (activity: ParsedActivity, isPublic: boolean) => void
}

/**
 * Debounced public/private toggle for a single activity. Optimistically updates
 * the local activity object and persists it to IndexedDB; the server patch is
 * delayed so rapid toggles do not fire multiple requests.
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

      activity.isPublic = isPublic
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
          await updateActivityVisibility(
            current.activity.contentHash!,
            current.isPublic
          )
          current.activity.isPublic = current.isPublic
          const saved = await updateActivityMetadata([
            { id: current.activity.id, isPublic: current.isPublic },
          ])
          if (!saved) throw new Error("Activity visibility could not be saved")
          onUpdated?.(current.activity.id, current.isPublic)
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
