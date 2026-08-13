import { useCallback, useRef, useState } from "react"
import type { ParsedTrack } from "~/types/tracks"
import { updateTrackVisibility } from "~/lib/server/trackVisibility"
import { canSync } from "~/lib/server/authStore"
import { saveTracks } from "~/lib/storage"

const SAVE_DELAY_MS = 600

interface UseTrackVisibilityResult {
  isLoading: boolean
  pendingValue: boolean | null
  change: (track: ParsedTrack, isPublic: boolean) => void
}

/**
 * Debounced public/private toggle for a single track. Optimistically updates
 * the local track object and persists it to IndexedDB; the server patch is
 * delayed so rapid toggles do not fire multiple requests.
 *
 * No-ops when the user is not signed in for sync or the track has no content
 * hash (and therefore no server row to update).
 */
export function useTrackVisibility(
  onUpdated?: (trackId: string, isPublic: boolean) => void
): UseTrackVisibilityResult {
  const [isLoading, setIsLoading] = useState(false)
  const [pendingValue, setPendingValue] = useState<boolean | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<{ track: ParsedTrack; isPublic: boolean } | null>(
    null
  )

  const change = useCallback(
    (track: ParsedTrack, isPublic: boolean) => {
      if (!canSync() || !track.contentHash) return

      latestRef.current = { track, isPublic }
      setPendingValue(isPublic)

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(async () => {
        const current = latestRef.current
        if (!current) return

        setIsLoading(true)
        try {
          await updateTrackVisibility(
            current.track.contentHash!,
            current.isPublic
          )
          current.track.isPublic = current.isPublic
          await saveTracks([current.track])
          onUpdated?.(current.track.id, current.isPublic)
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
