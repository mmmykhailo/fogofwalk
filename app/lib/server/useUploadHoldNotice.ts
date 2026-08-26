/**
 * The one description of "uploads are held off", shared by the account dialog
 * and the drawer row.
 *
 * Its own module rather than a member of `uploadGate`: the gate knows when
 * uploads resume but nothing about sync runs, and importing `syncEngine` there
 * would close a cycle — `syncEngine` already imports the gate.
 */

import { useUploadHoldSeconds } from "./uploadGate"

export function useUploadHoldNotice(): string | null {
  const seconds = useUploadHoldSeconds()
  return seconds === null
    ? null
    : `Upload limit reached — resuming in ${seconds}s`
}
