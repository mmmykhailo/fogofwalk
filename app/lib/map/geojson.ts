import {
  featureCollection,
  lineString,
  multiLineString,
  point,
} from "@turf/helpers"
import { pathsForActivity } from "~shared/activityContract"
import type {
  ActivityCoords,
  ActivityPaths,
  ParsedActivity,
} from "~/types/activities"
import type { SavedPoint } from "~shared/saved-points"
import { savedPointMarkerImageId } from "~/lib/map/savedPointMarkerImages"

export function activitiesFeatureCollection(
  activities: Pick<ParsedActivity, "id" | "name" | "coordinates" | "paths">[]
): GeoJSON.FeatureCollection<
  GeoJSON.LineString | GeoJSON.MultiLineString,
  { name: string; id: string }
> {
  const features: Array<
    GeoJSON.Feature<
      GeoJSON.LineString | GeoJSON.MultiLineString,
      { name: string; id: string }
    >
  > = []
  for (const activity of activities) {
    const paths = pathsForActivity(activity)
    const properties = { name: activity.name, id: activity.id }
    features.push(
      paths.length === 1
        ? lineString(paths[0]!, properties)
        : multiLineString(paths, properties)
    )
  }
  return featureCollection(features)
}

export function lapFeatureCollection(
  input: ActivityCoords | null
): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
export function lapFeatureCollection(
  input: ActivityPaths | null
): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
export function lapFeatureCollection(
  input: ActivityCoords | ActivityPaths | null
): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString> {
  if (!input || input.length === 0) return featureCollection([])
  const paths = Array.isArray(input[0]?.[0])
    ? (input as ActivityPaths)
    : [input as ActivityCoords]
  const renderablePaths = paths.filter((path) => path.length >= 2)
  if (renderablePaths.length === 0) return featureCollection([])
  const geometry =
    renderablePaths.length === 1
      ? lineString(renderablePaths[0]!)
      : multiLineString(renderablePaths)
  return featureCollection([geometry] as Array<
    GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>
  >)
}

export function savedPointsFeatureCollection(savedPoints: SavedPoint[]) {
  return featureCollection(
    savedPoints.map((savedPoint) =>
      point([savedPoint.lng, savedPoint.lat], {
        id: savedPoint.id,
        name: savedPoint.name,
        markerImage: savedPointMarkerImageId(savedPoint.color),
        stackOrder:
          Number.isFinite(savedPoint.createdAt) && savedPoint.createdAt >= 0
            ? savedPoint.createdAt
            : 0,
      })
    )
  )
}
