export const SCHEMA_VERSION = 1
export const MIN_ZOOM = 12
export const MAX_ZOOM = 12
export const SOURCE_LAYER = "trails"
export const MAX_HIKING_KEYS = 4
export const PARALLEL_LINE_SEPARATION_PX = 3
export const HIKING_FALLBACK_COLOR = "#7e22ce"
export const CYCLING_COLOR = "#ec4899"

export const HIKING_PALETTE = {
  red: "#d9272e",
  green: "#15803d",
  blue: "#1769aa",
  yellow: "#eab308",
  orange: "#ea580c",
  purple: HIKING_FALLBACK_COLOR,
  black: "#262626",
  brown: "#854d0e",
} as const

export const COLOR_ORDER = [
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "black",
  "brown",
] as const

const HIKING_NETWORK_RANKS: Record<string, number> = {
  iwn: 4,
  nwn: 3,
  rwn: 2,
  lwn: 1,
}

const CYCLING_NETWORK_RANKS: Record<string, number> = {
  icn: 4,
  ncn: 3,
  rcn: 2,
  lcn: 1,
}

export type TrailKind = "hiking" | "cycling"
export type TrailTags = Record<string, string>

export interface ColorNormalization {
  color: string
  colorName: string
  unsupported: boolean
}

export interface RelationClassification {
  id: number
  kind: TrailKind
  networkRank: number
  color: string
  colorName: string
  superRoute: boolean
  unsupportedColor: boolean
}

export interface TrailMembership {
  relationId: number
  kind: TrailKind
  networkRank: number
  color: string
  inherited: boolean
}

export interface TrailVisualFeature {
  relationId: number
  kind: TrailKind
  color: string
  offset: number
  sort: number
}

export interface TrailTilePropertiesV1 {
  kind: TrailKind
  color: string
  offset: number
  sort: number
}

export interface VisualSelection {
  features: TrailVisualFeature[]
  droppedKeys: number
}

/** Classifies only the exact relation forms accepted by schema v1. */
export function classifyRelation(
  id: number,
  tags: TrailTags
): RelationClassification | null {
  const type = tags.type ?? ""
  if (type !== "route" && type !== "superroute") return null

  const route = tags.route ?? ""
  const kind: TrailKind | null =
    route === "bicycle"
      ? "cycling"
      : route === "hiking" || route === "foot"
        ? "hiking"
        : null
  if (!kind) return null

  const colorNormalization =
    kind === "hiking"
      ? normalizeHikingColor(tags)
      : { color: CYCLING_COLOR, colorName: "cycling", unsupported: false }

  return {
    id,
    kind,
    networkRank: networkRank(kind, tags.network ?? ""),
    color: colorNormalization.color,
    colorName: colorNormalization.colorName,
    superRoute: type === "superroute",
    unsupportedColor: colorNormalization.unsupported,
  }
}

export function networkRank(kind: TrailKind, network: string): number {
  return (
    (kind === "hiking" ? HIKING_NETWORK_RANKS : CYCLING_NETWORK_RANKS)[
      network
    ] ?? 0
  )
}

/** Applies osmc:symbol, colour, color precedence and the closed v1 palette. */
export function normalizeHikingColor(tags: TrailTags): ColorNormalization {
  let raw: unknown
  if (Object.hasOwn(tags, "osmc:symbol")) {
    raw = firstSymbolComponent(tags["osmc:symbol"])
  } else if (Object.hasOwn(tags, "colour")) {
    raw = tags.colour
  } else if (Object.hasOwn(tags, "color")) {
    raw = tags.color
  } else {
    return {
      color: HIKING_FALLBACK_COLOR,
      colorName: "purple",
      unsupported: false,
    }
  }
  return normalizeColorToken(raw)
}

/** Selects one feature per visual key and calculates centered screen offsets. */
export function selectVisualFeatures(
  memberships: TrailMembership[]
): VisualSelection {
  const strongestByKey = new Map<string, TrailMembership>()
  for (const membership of memberships) {
    const key = visualKey(membership)
    const previous = strongestByKey.get(key)
    if (!previous || isStronger(membership, previous)) {
      strongestByKey.set(key, membership)
    }
  }

  const hiking: TrailMembership[] = []
  let cycling: TrailMembership | null = null
  for (const membership of strongestByKey.values()) {
    if (membership.kind === "hiking") hiking.push(membership)
    else if (!cycling || isStronger(membership, cycling)) cycling = membership
  }

  hiking.sort(
    (a, b) =>
      b.networkRank - a.networkRank ||
      colorOrder(a.color) - colorOrder(b.color) ||
      a.relationId - b.relationId
  )

  const droppedKeys = Math.max(0, hiking.length - MAX_HIKING_KEYS)
  const selectedHiking = hiking.slice(0, MAX_HIKING_KEYS)
  const features: TrailVisualFeature[] = selectedHiking.map(
    (membership, index) => ({
      relationId: membership.relationId,
      kind: membership.kind,
      color: membership.color,
      offset:
        (index - (selectedHiking.length - 1) / 2) * PARALLEL_LINE_SEPARATION_PX,
      sort: 10 + membership.networkRank,
    })
  )

  if (cycling) {
    features.push({
      relationId: cycling.relationId,
      kind: "cycling",
      color: CYCLING_COLOR,
      offset: 0,
      sort: 20 + cycling.networkRank,
    })
  }

  return { features, droppedKeys }
}

export function colorOrder(color: string): number {
  const colorName = COLOR_ORDER.find(
    (name) => name === color || HIKING_PALETTE[name] === color
  )
  return colorName ? COLOR_ORDER.indexOf(colorName) : COLOR_ORDER.length
}

function visualKey(membership: TrailMembership): string {
  return membership.kind === "hiking"
    ? `${membership.kind}:${membership.color}`
    : membership.kind
}

function isStronger(
  candidate: TrailMembership,
  previous: TrailMembership
): boolean {
  return (
    candidate.networkRank > previous.networkRank ||
    (candidate.networkRank === previous.networkRank &&
      candidate.relationId < previous.relationId)
  )
}

function firstSymbolComponent(raw: unknown): string {
  const value = raw === null || raw === undefined ? "" : String(raw).trim()
  const separator = value.indexOf(":")
  return separator < 0 ? value : value.slice(0, separator)
}

function normalizeColorToken(raw: unknown): ColorNormalization {
  const token =
    raw === null || raw === undefined ? "" : String(raw).trim().toLowerCase()
  const color = HIKING_PALETTE[token as keyof typeof HIKING_PALETTE]
  if (!color) {
    return {
      color: HIKING_FALLBACK_COLOR,
      colorName: "purple",
      unsupported: true,
    }
  }
  return { color, colorName: token, unsupported: false }
}
