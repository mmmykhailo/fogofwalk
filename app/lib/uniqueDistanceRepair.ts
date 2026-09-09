import type { ParsedActivity } from "~/types/activities"
import {
  areUniqueDistancesCurrent,
  loadUniqueDistanceState,
  saveUniqueDistances,
  type UniqueDistanceState,
} from "~/lib/storage"
import { computeUniqueDistancesInWorker } from "~/lib/uniqueDistanceWorkerClient"
import { markPerformance, measurePerformance } from "~/lib/performance"

type RepairOperation = (activities: ParsedActivity[]) => Promise<void>

let pendingRepair: Promise<void> | null = null
let pendingSignature: string | null = null

function activitySignature(activities: ParsedActivity[]): string {
  return activities.map((activity) => activity.id).join("\u0000")
}

async function repairUniqueDistances(
  activities: ParsedActivity[]
): Promise<void> {
  const result = await computeUniqueDistancesInWorker(activities)
  for (const activity of activities) {
    activity.stats.uniqueDistanceKm =
      result.get(activity.id) ?? activity.stats.distanceKm
  }
  if (!(await saveUniqueDistances(activities))) {
    throw new Error("Unique-distance values could not be saved")
  }
}

/**
 * Ensures the ordered-library unique-distance marker is current.
 *
 * Consumers of the same collection share one worker/persistence operation.
 * A changed collection waits for the earlier operation and then checks again,
 * while a failed operation is never treated as current and can be retried.
 * The optional operation is intentionally injectable for deterministic tests.
 */
export function ensureUniqueDistancesCurrent(
  activities: ParsedActivity[],
  state?: UniqueDistanceState | null,
  operation: RepairOperation = repairUniqueDistances
): Promise<void> {
  const signature = activitySignature(activities)
  if (pendingRepair && pendingSignature === signature) return pendingRepair

  const previous = pendingRepair
  const stateForThisRun = previous ? undefined : state
  const run = (async () => {
    if (previous) {
      try {
        await previous
      } catch {
        // A later attempt must still get a chance to repair the same library.
      }
    }
    const current = stateForThisRun ?? (await loadUniqueDistanceState())
    if (areUniqueDistancesCurrent(activities, current)) return
    markPerformance("activities:unique-distance:start")
    try {
      await operation(activities)
    } finally {
      markPerformance("activities:unique-distance:end")
      measurePerformance(
        "activities:unique-distance",
        "activities:unique-distance:start",
        "activities:unique-distance:end"
      )
    }
  })()

  let next: Promise<void>
  next = run.finally(() => {
    if (pendingRepair === next) {
      pendingRepair = null
      pendingSignature = null
    }
  })
  pendingRepair = next
  pendingSignature = signature
  return next
}
