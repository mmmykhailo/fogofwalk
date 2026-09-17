import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson"
import {
  TRAIL_DATA_ZOOM,
  TRAIL_HIKING_COLORS,
  TRAIL_THEMES,
} from "~/constants/trails"

export type TrailTheme = (typeof TRAIL_THEMES)[number]
export type KctColorToken = keyof typeof TRAIL_HIKING_COLORS

export type TrailErrorCode =
  | "invalid_protocol_url"
  | "http_error"
  | "timeout"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_collection"
  | "invalid_geometry"
  | "limit_exceeded"
  | "encode_failed"

export class TrailTileError extends Error {
  constructor(
    public readonly code: TrailErrorCode,
    public readonly stats?: Partial<TrailNormalizationStats>
  ) {
    super(code)
    this.name = "TrailTileError"
  }
}

export interface TrailTileCoordinate {
  theme: TrailTheme
  z: typeof TRAIL_DATA_ZOOM
  x: number
  y: number
}

export interface WaymarkedTrailProperties {
  type?: unknown
  top_relations?: unknown
  child_relations?: unknown
  shields?: unknown
  style?: unknown
  class?: unknown
}

export interface RenderTrailProperties {
  kind: TrailTheme
  color: string
  offset: number
  sort: number
}

export interface TrailNormalizationStats {
  inputFeatures: number
  outputFeatures: number
  droppedFeatures: number
  coordinateCount: number
}

export interface NormalizedTrailTile {
  collection: FeatureCollection<
    LineString | MultiLineString,
    RenderTrailProperties
  >
  stats: TrailNormalizationStats
}

export interface ProjectedTrailGeometry {
  geometry: LineString | MultiLineString
  coordinateCount: number
}

export type RenderTrailFeature = Feature<
  LineString | MultiLineString,
  RenderTrailProperties
>
