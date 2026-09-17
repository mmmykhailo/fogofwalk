import {
  TRAIL_MAX_COORDINATES_PER_TILE,
  TRAIL_MAX_FEATURES_PER_TILE,
  TRAIL_MAX_PARALLEL_COLORS,
  TRAIL_PROVIDER_WAY_TYPE,
} from "~/constants/trails"
import { classifyTrailFeature } from "~/lib/map/trails/classification"
import { projectTrailGeometry } from "~/lib/map/trails/projection"
import {
  TrailTileError,
  type NormalizedTrailTile,
  type RenderTrailFeature,
  type TrailNormalizationStats,
  type TrailTheme,
} from "~/lib/map/trails/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isProperties(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

function initialStats(inputFeatures: number): TrailNormalizationStats {
  return {
    inputFeatures,
    outputFeatures: 0,
    droppedFeatures: 0,
    coordinateCount: 0,
  }
}

export function normalizeTrailTile(
  input: unknown,
  theme: TrailTheme
): NormalizedTrailTile {
  if (!isRecord(input) || input.type !== "FeatureCollection") {
    throw new TrailTileError("invalid_collection")
  }

  const providerFeatures = input.features
  if (!Array.isArray(providerFeatures)) {
    throw new TrailTileError("invalid_collection")
  }

  const stats = initialStats(providerFeatures.length)
  if (providerFeatures.length > TRAIL_MAX_FEATURES_PER_TILE) {
    throw new TrailTileError("limit_exceeded", stats)
  }

  const features: RenderTrailFeature[] = []
  for (
    let providerFeatureIndex = 0;
    providerFeatureIndex < providerFeatures.length;
    providerFeatureIndex += 1
  ) {
    const providerFeature = providerFeatures[providerFeatureIndex]
    if (
      !isRecord(providerFeature) ||
      providerFeature.type !== "Feature" ||
      !isProperties(providerFeature.properties) ||
      providerFeature.properties.type !== TRAIL_PROVIDER_WAY_TYPE
    ) {
      stats.droppedFeatures += 1
      continue
    }

    let projected
    try {
      projected = projectTrailGeometry(
        providerFeature.geometry,
        TRAIL_MAX_COORDINATES_PER_TILE - stats.coordinateCount
      )
    } catch (error) {
      if (error instanceof TrailTileError && error.code === "limit_exceeded") {
        throw new TrailTileError("limit_exceeded", {
          ...stats,
          coordinateCount:
            stats.coordinateCount + (error.stats?.coordinateCount ?? 0),
        })
      }
      throw error
    }

    if (!projected) {
      stats.droppedFeatures += 1
      continue
    }

    const properties = classifyTrailFeature(
      theme,
      providerFeature.properties.shields
    )
    stats.coordinateCount += projected.coordinateCount

    for (let colorIndex = 0; colorIndex < properties.length; colorIndex += 1) {
      const renderProperties = properties[colorIndex]
      if (!renderProperties) continue
      features.push({
        type: "Feature",
        id: providerFeatureIndex * TRAIL_MAX_PARALLEL_COLORS + colorIndex,
        geometry: projected.geometry,
        properties: renderProperties,
      })
    }
  }

  stats.outputFeatures = features.length
  return {
    collection: {
      type: "FeatureCollection",
      features,
    },
    stats,
  }
}
