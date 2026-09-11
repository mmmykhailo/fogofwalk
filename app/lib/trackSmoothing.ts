import type { RawPoint } from "~/types/activities"
import { haversineKm } from "~/lib/stats"

const MIN_ANOMALOUS_SEGMENT_M = 250
const MAX_ANOMALOUS_SEGMENT_M = 1000
const ANOMALOUS_STEP_MULTIPLIER = 12
const MAX_ANOMALOUS_GAP_MS = 60_000
const MAX_RETURN_GAP_RATIO = 0.5
// How far apart two anomalous segments can sit and still belong to one spike.
const MAX_SPIKE_RUN_GAP = 3
// How many points a spike can span. A longer run is the route itself, sampled
// sparsely, not an artefact.
const MAX_SPIKE_CLUSTER_POINTS = 3
// Every activity this app records is human powered, so a sustained 150 km/h is
// far above anything a rider on a descent can reach. Only a broken fix gets
// there.
const IMPOSSIBLE_SPEED_KMH = 150

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  // For an even sample count, use the lower middle value. GPS interference
  // can make half of the local segments huge; the lower middle stays anchored
  // to the normal movement scale in that case.
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function distanceM(a: RawPoint, b: RawPoint): number {
  return haversineKm(a.lng, a.lat, b.lng, b.lat) * 1000
}

/**
 * Confirms that the points between `start` and `end` left the route and came
 * back: the anchors on either side of the run have to stay close together
 * compared with how far the run strays from them.
 *
 * A route that simply carries on moves its anchors apart by roughly the
 * distance the run covers, so a long but valid interval fails this check. The
 * distance alone cannot tell the two apart, which matters most for tracks
 * without timestamps: there the time gap can never rule a segment out.
 */
function isJumpOutAndReturn(
  points: RawPoint[],
  start: number,
  end: number
): boolean {
  const before = points[start]
  const after = points[end + 1]
  const anchorGapM = distanceM(before, after)
  let excursionM = 0
  for (let pointIndex = start + 1; pointIndex <= end; pointIndex++) {
    excursionM = Math.max(
      excursionM,
      distanceM(points[pointIndex], before),
      distanceM(points[pointIndex], after)
    )
  }
  return excursionM > 0 && anchorGapM <= excursionM * MAX_RETURN_GAP_RATIO
}

/**
 * Replaces isolated GPS spikes with a neighbouring coordinate.
 *
 * Only the points identified as strays are touched, and each is pulled onto a
 * neighbour that survived the test. Nothing is averaged: a smoothing average
 * drags every point a little and rounds off genuine corners, which is the
 * wrong trade for an artefact that hits a handful of points hard and leaves
 * the rest of the route correct. The median of the segment lengths sizes the
 * anomaly threshold and never becomes a coordinate. The original point count
 * is retained so FIT lap indices and timestamps stay aligned with the
 * geometry, and a stray's elevation travels with its coordinates.
 *
 * Segments are anomalous when they are large relative to the route's typical
 * step, but a large segment alone never identifies which of its endpoints
 * moved, and a valid sparse interval after a pause is large too. Two different
 * kinds of evidence settle it. A run that jumps away and comes back names the
 * points in between as the strays. A single jump at the very start or end of a
 * track has no return to look for, so only a speed no athlete can reach marks
 * the short side of it as a stray.
 */
function smoothPass(points: RawPoint[]): RawPoint[] {
  // Always a copy, whatever the length, so callers never have to know whether
  // this pass had anything to do.
  if (points.length < 3) return points.map((point) => ({ ...point }))

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
    MAX_ANOMALOUS_SEGMENT_M,
    Math.max(MIN_ANOMALOUS_SEGMENT_M, typicalStepM * ANOMALOUS_STEP_MULTIPLIER)
  )
  const result = points.map((point) => ({ ...point }))
  const lastPoint = points.length - 1

  const longSegments = segmentDistances
    .map((distance, index) => (distance > thresholdM ? index : -1))
    .filter((index) => index >= 0)

  const elapsedMs = (segmentIndex: number): number | undefined => {
    const previous = points[segmentIndex]
    const current = points[segmentIndex + 1]
    if (previous.timestampMs == null || current.timestampMs == null) {
      return undefined
    }
    return Math.abs(current.timestampMs - previous.timestampMs)
  }

  const isImpossiblyFast = (segmentIndex: number) => {
    const deltaMs = elapsedMs(segmentIndex)
    if (deltaMs == null) return false
    // Two fixes sharing a timestamp cannot be a quarter kilometre apart.
    if (deltaMs === 0) return true
    const speedKmh =
      segmentDistances[segmentIndex] / 1000 / (deltaMs / 3_600_000)
    return speedKmh > IMPOSSIBLE_SPEED_KMH
  }

  // A pause explains a long segment on its own: the receiver sat still, or
  // recording stopped, and the next fix is honestly far away. Two things rule
  // that out. Too little time passed for a pause to have happened, or so much
  // ground was covered that nobody could have travelled it. Either is enough,
  // and a lost fix often produces both legs of an excursion behind long gaps.
  const isUnexplainedByPause = (segmentIndex: number) => {
    const deltaMs = elapsedMs(segmentIndex)
    if (deltaMs == null) return true
    return deltaMs <= MAX_ANOMALOUS_GAP_MS || isImpossiblyFast(segmentIndex)
  }

  const collapseOnto = (from: number, to: number, anchor: RawPoint) => {
    for (let pointIndex = from; pointIndex <= to; pointIndex++) {
      result[pointIndex].lng = anchor.lng
      result[pointIndex].lat = anchor.lat
      // A stray's altitude is as wrong as its position, and elevation gain
      // reads these points too. Leaving it behind keeps the spike in the climb
      // total and in the elevation profile after the map already looks clean.
      result[pointIndex].elevationM = anchor.elevationM
    }
  }

  let longIndex = 0
  while (longIndex < longSegments.length) {
    const runStart = longIndex
    const start = longSegments[longIndex]
    let end = start
    while (
      longIndex + 1 < longSegments.length &&
      longSegments[longIndex + 1] - end <= MAX_SPIKE_RUN_GAP
    ) {
      longIndex++
      end = longSegments[longIndex]
    }
    longIndex++
    const runSegments = longSegments.slice(runStart, longIndex)

    // An anchor is worth trusting only where a normal step corroborates it,
    // and at either end of a track nothing does. A run reaching an end has no
    // sound anchor on that side, so there is no return there to look for.
    const isBracketed = end > start && end + 1 < lastPoint

    if (isBracketed) {
      // The run jumps away and back, so the points it brackets are the strays
      // and the point the first jump started from is a sound anchor. A spike
      // is short lived by definition: a longer run is a sparsely sampled
      // stretch of route, and any stretch that loops back brings its own two
      // ends together, which is the very shape the return test looks for.
      if (end - start > MAX_SPIKE_CLUSTER_POINTS) continue
      if (!runSegments.some(isUnexplainedByPause)) continue
      if (!isJumpOutAndReturn(points, start, end)) continue
      collapseOnto(start + 1, end, points[start])
      continue
    }

    // Nothing corroborates an anchor beyond this run, so no return can be
    // confirmed. Every interior point is corroborated by a normal step on its
    // far side, which leaves only a short head or tail of the track as the
    // stray, and it has to be the shorter of the two sides. Only a speed
    // nobody can reach separates that from a valid sparse stretch.
    if (!runSegments.some(isImpossiblyFast)) continue
    const headLength = start + 1
    const tailLength = lastPoint - start
    if (tailLength <= MAX_SPIKE_CLUSTER_POINTS && tailLength < headLength) {
      collapseOnto(start + 1, lastPoint, points[start])
    } else if (
      headLength <= MAX_SPIKE_CLUSTER_POINTS &&
      headLength < tailLength
    ) {
      collapseOnto(0, start, points[start + 1])
    }
  }
  return result
}

export const smoothTrack = smoothPass
