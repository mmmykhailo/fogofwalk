import { featureCollection, lineString, point } from "@turf/helpers"
import type { ActivityCoords, ParsedActivity } from "~/types/activities"
import { SAVED_POINT_COLORS, type SavedPoint } from "~shared/saved-points"

export function activitiesFeatureCollection(
  activities: Pick<ParsedActivity, "id" | "name" | "coordinates">[]
) {
  return featureCollection(
    activities.map((activity) =>
      lineString(activity.coordinates, {
        name: activity.name,
        id: activity.id,
      })
    )
  )
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
        color: SAVED_POINT_COLORS[savedPoint.color],
      })
    )
  )
}
