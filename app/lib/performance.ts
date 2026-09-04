/** Small performance instrumentation helpers kept safe for non-browser callers. */
export function markPerformance(name: string): void {
  if (typeof performance === "undefined") return
  performance.mark(name)
}

export function measurePerformance(
  name: string,
  startMark: string,
  endMark: string
): void {
  if (typeof performance === "undefined") return
  try {
    performance.measure(name, startMark, endMark)
  } catch {
    // A missing mark should never affect the route itself.
  }
}
