/**
 * Performance entries are diagnostic test data, not application telemetry.
 * Keep the helpers inert in normal builds so instrumentation cannot affect a
 * user's performance timeline or retain entries for the lifetime of a page.
 */
const isE2ePerformanceBuild = import.meta.env.VITE_E2E === "1"

export type PerformanceCounterName =
  | "homeLoaderStarts"
  | "homeBootstrapStarts"
  | "homeBootstrapCompletions"
  | "photoStoreReads"
  | "savedPointStoreReads"
  | "preferenceStoreReads"
  | "fogWorkerRebuildRequests"
  | "fogWorkerAppendRequests"
  | "mapSourceSetDataCalls"
  | "activityPaintUpdates"
  | "mapRouteCommits"
  | "mapDialogCommits"
  | "visibilityControlCommits"
  | "draggableTransformWrites"
  | "mapUiNavigations"

declare global {
  interface Window {
    /** Installed by the performance fixture before an E2E page loads. */
    __fogofwalkE2ePerformanceCounters?: Record<string, number>
  }
}

function getPerformance(): Performance | null {
  if (!isE2ePerformanceBuild || typeof window === "undefined") return null
  return window.performance
}

/** Increment a fixture-owned counter without adding normal-build state. */
export function incrementPerformanceCounter(
  name: PerformanceCounterName,
  amount = 1
): void {
  if (!isE2ePerformanceBuild || typeof window === "undefined") return
  const counters = window.__fogofwalkE2ePerformanceCounters
  if (!counters) return
  counters[name] = (counters[name] ?? 0) + amount
}

/** Mark a React commit from a leaf effect, never during render. */
export function markPerformanceCommit(
  counter: Extract<
    PerformanceCounterName,
    "mapRouteCommits" | "mapDialogCommits" | "visibilityControlCommits"
  >,
  markName: string
): void {
  incrementPerformanceCounter(counter)
  markPerformance(markName)
}

export function markPerformance(name: string): void {
  const currentPerformance = getPerformance()
  if (!currentPerformance) return
  try {
    currentPerformance.mark(name)
  } catch {
    // A diagnostic API failure must never affect the route itself.
  }
}

export function measurePerformance(
  name: string,
  startMark: string,
  endMark: string
): void {
  const currentPerformance = getPerformance()
  if (!currentPerformance) return
  try {
    currentPerformance.clearMeasures(name)
    currentPerformance.measure(name, startMark, endMark)
  } catch {
    // A missing mark should never affect the route itself.
  } finally {
    // Marks are implementation details of one measurement. Clearing only the
    // names this call owns prevents stale marks from joining a later run while
    // retaining the measure entries as raw diagnostics.
    try {
      currentPerformance.clearMarks(startMark)
      currentPerformance.clearMarks(endMark)
    } catch {
      // Cleanup is best effort for older or mocked Performance objects.
    }
  }
}

/** Read the clock without exposing a browser-only dependency to callers. */
export function performanceNow(): number | null {
  return getPerformance()?.now() ?? null
}

/** Reset the diagnostic buffer between benchmark samples. */
export function clearPerformanceMeasurements(): void {
  const currentPerformance = getPerformance()
  if (!currentPerformance) return
  try {
    currentPerformance.clearMarks()
    currentPerformance.clearMeasures()
  } catch {
    // A diagnostic API failure must never affect the route itself.
  }
}

/** Record an already-computed duration without putting timing calls in render. */
export function measurePerformanceDuration(
  name: string,
  durationMs: number
): void {
  const currentPerformance = getPerformance()
  if (!currentPerformance || !Number.isFinite(durationMs)) return
  try {
    currentPerformance.clearMeasures(name)
    const end = currentPerformance.now()
    currentPerformance.measure(name, {
      start: Math.max(0, end - Math.max(0, durationMs)),
      end,
    })
  } catch {
    // A diagnostic API failure must never affect the route itself.
  }
}
