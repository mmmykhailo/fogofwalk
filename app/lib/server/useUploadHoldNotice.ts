/**
 * The one description of "uploads are held off", shared by the account dialog
 * and the drawer row.
 *
 * Its own module rather than a member of `uploadGate`: the gate knows when
 * uploads resume but nothing about sync runs, and importing `syncEngine` there
 * would close a cycle — `syncEngine` already imports the gate.
 */

import { useSyncStatus } from "./syncEngine"
import { useUploadHoldSeconds } from "./uploadGate"

export function useUploadHoldNotice(): string | null {
  const seconds = useUploadHoldSeconds()
  const status = useSyncStatus()

  /**
   * Only while a run is actually open. Once the retries are spent the run ends
   * and reports its own failure; the deadline still gates the *next* attempt,
   * but nothing is going to resume on its own, so promising a countdown there
   * would be a lie.
   */
  if (seconds === null || status.phase !== "syncing") return null
  return `Upload limit reached — resuming in ${seconds}s`
}
