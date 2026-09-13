import {
  featureCollection,
  lineString,
  multiLineString,
  point,
} from "@turf/helpers"
import { pathsForActivity } from "~shared/activityContract"
import type { ActivityCoords, ParsedActivity } from "~/types/activities"
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

export function lapFeatureCollection(coordinates: ActivityCoords | null) {
  return featureCollection(
    coordinates && coordinates.length >= 2 ? [lineString(coordinates)] : []
  )
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
