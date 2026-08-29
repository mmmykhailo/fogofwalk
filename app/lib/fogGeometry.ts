import buffer from "@turf/buffer"
import difference from "@turf/difference"
import simplify from "@turf/simplify"
import union from "@turf/union"
import { featureCollection, lineString, polygon } from "@turf/helpers"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import type { ActivityCoords } from "~/types/activities"
import {
  ACTIVITY_SIMPLIFY_TOLERANCE,
  BUFFER_STEPS,
  FOG_CLEAR_RADIUS_METERS,
  SIMPLIFY_TOLERANCE,
} from "~/constants/fog"

export type FogFeature = Feature<Polygon | MultiPolygon>

export function worldFogFeature(): Feature<Polygon> {
  return polygon([
    [
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
      [-180, -90],
    ],
  ])
}

/** Keep only coordinates that GeoJSON and Turf can safely process. */
export function validFogCoordinates(
  coordinates: ActivityCoords
): ActivityCoords {
  return coordinates.filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
  )
}

/** Build the buffered corridor for one activity, or null when it has no line. */
export function createActivityFogBuffer(
  coordinates: ActivityCoords
): FogFeature | null {
  const validCoordinates = validFogCoordinates(coordinates)
  if (validCoordinates.length < 2) return null

  const simplified = simplify(lineString(validCoordinates), {
    tolerance: ACTIVITY_SIMPLIFY_TOLERANCE,
    highQuality: false,
    mutate: true,
  })
  return (
    (buffer(simplified, FOG_CLEAR_RADIUS_METERS, {
      units: "meters",
      steps: BUFFER_STEPS,
    }) as FogFeature | undefined) ?? null
  )
}

function polygonCoordinates(feature: FogFeature): MultiPolygon["coordinates"] {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

/**
 * Union two masks without ever throwing one of them away. Turf can reject a
 * numerically awkward union; a MultiPolygon fallback still preserves both
 * corridors and lets later operations retry the union.
 */
export function mergeFogMasks(
  first: FogFeature,
  second: FogFeature,
  unionOperation: typeof union = union
): FogFeature {
  try {
    const merged = unionOperation(featureCollection([first, second]))
    if (merged) return merged as FogFeature
  } catch {
    // Preserve both masks below. A later merge may still normalize them.
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        ...polygonCoordinates(first),
        ...polygonCoordinates(second),
      ],
    },
  }
}

/**
 * Subtract a batch in one operation, then retry mask-by-mask if the combined
 * clipping operation fails. One problematic mask must not discard the other
 * successfully processed activities.
 */
export function subtractFogMasks(
  subject: FogFeature,
  masks: FogFeature[],
  onMaskError?: (index: number, error: unknown) => void
): FogFeature {
  if (masks.length === 0) return subject

  try {
    const result = difference(featureCollection([subject, ...masks]))
    if (result) return result as FogFeature
  } catch {
    // Retry separately below so a single awkward geometry is isolated.
  }

  return masks.reduce((current, mask, index) => {
    try {
      return (
        (difference(featureCollection([current, mask])) as FogFeature | null) ??
        current
      )
    } catch (error) {
      onMaskError?.(index, error)
      return current
    }
  }, subject)
}

// Removes inner rings from a polygon/multipolygon so that a closed-loop buffer
// becomes a filled shape. Used in fill mode to clear loop interiors.
export function stripInnerRings(feature: FogFeature): FogFeature {
  const geometry = feature.geometry
  if (geometry.type === "Polygon") {
    return geometry.coordinates.length <= 1
      ? feature
      : {
          ...feature,
          geometry: {
            type: "Polygon",
            coordinates: [geometry.coordinates[0]],
          },
        }
  }
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((coordinates) => [coordinates[0]]),
    },
  }
}

/** Reduce the geometry sent across the worker boundary without changing state. */
export function simplifyFogForEmission(feature: FogFeature): FogFeature {
  try {
    return (
      (simplify(feature, {
        tolerance: SIMPLIFY_TOLERANCE,
        highQuality: false,
        mutate: false,
      }) as FogFeature) ?? feature
    )
  } catch {
    return feature
  }
}
