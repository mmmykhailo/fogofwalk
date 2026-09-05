import type { RawPoint } from "~/types/activities"
import { haversineKm } from "~/lib/stats"

const MIN_ANOMALOUS_SEGMENT_M = 250
const ANOMALOUS_STEP_MULTIPLIER = 12
const MAX_ANOMALOUS_GAP_MS = 60_000

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  // For an even sample count, use the lower middle value. GPS interference
  // can make half of the local segments huge; the lower middle stays anchored
  // to the normal movement scale in that case.
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/**
 * Replaces isolated GPS spikes with the local coordinate median.
 *
 * A median filter is deliberately used instead of averaging every point:
 * averaging can shift genuine corners, while a median removes the large,
 * short-lived jumps commonly produced by a lost or interfered GPS signal.
 * The original point count is retained so FIT lap indices and timestamps stay
 * aligned with the geometry.
 *
 * We only smooth segments that look like a short-lived jump-out-and-return:
 * they must be large relative to the route's typical step and occur without a
 * long pause. A valid sparse interval after a pause has a long time gap, so it
 * is left untouched even when its distance is much larger than the median.
 */
function smoothPass(points: RawPoint[]): RawPoint[] {
  if (points.length < 3) return points

  const segmentDistances = points
    .slice(1)
    .map(
      (point, index) =>
        haversineKm(
          points[index].lng,
          points[index].lat,
          point.lng,
          point.lat
        ) * 1000
    )
  const typicalStepM = median(segmentDistances)
  const thresholdM = Math.min(
    1000,
    Math.max(MIN_ANOMALOUS_SEGMENT_M, typicalStepM * ANOMALOUS_STEP_MULTIPLIER)
  )
  const result = points.map((point) => ({ ...point }))

  const badSegments = segmentDistances
    .map((distance, index) => {
      const previous = points[index]
      const current = points[index + 1]
      const deltaMs =
        previous.timestampMs != null && current.timestampMs != null
          ? Math.abs(current.timestampMs - previous.timestampMs)
          : undefined
      const isShortLivedSpike =
        distance > thresholdM &&
        (deltaMs == null || deltaMs <= MAX_ANOMALOUS_GAP_MS)
      return isShortLivedSpike ? index : -1
    })
    .filter((index) => index >= 0)

  let badIndex = 0
  while (badIndex < badSegments.length) {
    const start = badSegments[badIndex]
    let lastBadSegment = start
    while (
      badIndex + 1 < badSegments.length &&
      badSegments[badIndex + 1] - lastBadSegment <= 3
    ) {
      badIndex++
      lastBadSegment = badSegments[badIndex]
    }
    const end = lastBadSegment
    const before =
      start > 0 ? points[start - 1] : points[end + 1] ?? points[start]
    for (let pointIndex = start; pointIndex <= end; pointIndex++) {
      result[pointIndex].lng = before.lng
      result[pointIndex].lat = before.lat
    }
    badIndex++
  }
  return result
}

export const smoothTrack = smoothPass
