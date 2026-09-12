import { useLayoutEffect } from "react"
import {
  markPerformanceCommit,
  type PerformanceCounterName,
} from "~/lib/performance"

interface PerformanceCommitMarkerProps {
  counter: Extract<
    PerformanceCounterName,
    "mapRouteCommits" | "mapDialogCommits" | "visibilityControlCommits"
  >
  mark: string
}

/** A tiny test-only leaf used to count commits after the DOM has been updated. */
export function PerformanceCommitMarker({
  counter,
  mark,
}: PerformanceCommitMarkerProps) {
  useLayoutEffect(() => {
    markPerformanceCommit(counter, mark)
  })
  return null
}
