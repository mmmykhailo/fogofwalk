import {
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_SORT_ORDER,
  TRAIL_HIKING_COLOR_ORDER,
  TRAIL_HIKING_COLORS,
  TRAIL_HIKING_FALLBACK_COLOR,
  TRAIL_HIKING_SORT_ORDER,
  TRAIL_KCT_SHIELD_PATTERN,
  TRAIL_MAX_PARALLEL_COLORS,
  TRAIL_PARALLEL_LINE_SEPARATION_PX,
} from "~/constants/trails"
import type {
  KctColorToken,
  RenderTrailProperties,
  TrailTheme,
} from "~/lib/map/trails/types"

function isKctColorToken(value: string): value is KctColorToken {
  return Object.prototype.hasOwnProperty.call(TRAIL_HIKING_COLORS, value)
}

export function extractKctColorTokens(shields: unknown): KctColorToken[] {
  if (!Array.isArray(shields)) return []

  const found = new Set<KctColorToken>()
  for (const shield of shields) {
    if (typeof shield !== "string") continue
    const match = TRAIL_KCT_SHIELD_PATTERN.exec(shield.toLowerCase())
    const token = match?.[1]
    if (token && isKctColorToken(token)) found.add(token)
  }

  return TRAIL_HIKING_COLOR_ORDER.filter((token) => found.has(token))
}

export function centeredTrailOffsets(count: number): number[] {
  if (!Number.isSafeInteger(count) || count <= 0) return []
  return Array.from(
    { length: count },
    (_, index) => (index - (count - 1) / 2) * TRAIL_PARALLEL_LINE_SEPARATION_PX
  )
}

export function classifyTrailFeature(
  theme: TrailTheme,
  shields: unknown
): RenderTrailProperties[] {
  if (theme === "cycling") {
    return [
      {
        kind: "cycling",
        color: TRAIL_CYCLING_COLOR,
        offset: 0,
        sort: TRAIL_CYCLING_SORT_ORDER,
      },
    ]
  }

  const colors = extractKctColorTokens(shields).slice(
    0,
    TRAIL_MAX_PARALLEL_COLORS
  )
  if (colors.length === 0) {
    return [
      {
        kind: "hiking",
        color: TRAIL_HIKING_FALLBACK_COLOR,
        offset: 0,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
    ]
  }

  return colors.map((token, index) => ({
    kind: "hiking",
    color: TRAIL_HIKING_COLORS[token],
    offset: centeredTrailOffsets(colors.length)[index] ?? 0,
    sort: TRAIL_HIKING_SORT_ORDER,
  }))
}
