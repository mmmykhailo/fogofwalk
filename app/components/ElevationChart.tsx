import type { ElevationPoint } from "~/types/activities"
import { ACTIVITY_COLOR } from "~/constants/fog"

interface ElevationChartProps {
  profile: ElevationPoint[]
  className?: string
}

const PAD = { top: 8, right: 4, bottom: 16, left: 32 }
const W = 300
const H = 80
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

export function ElevationChart({ profile, className }: ElevationChartProps) {
  if (profile.length < 2) return null

  const minEle = Math.min(...profile.map((p) => p.elevationM))
  const maxEle = Math.max(...profile.map((p) => p.elevationM))
  const maxDist = profile[profile.length - 1].distanceKm
  const eleRange = maxEle === minEle ? 1 : maxEle - minEle

  const toX = (d: number) => PAD.left + (d / maxDist) * PLOT_W
  const toY = (e: number) => PAD.top + (1 - (e - minEle) / eleRange) * PLOT_H

  const pts = profile.map((p) => `${toX(p.distanceKm)},${toY(p.elevationM)}`)
  const linePath = `M ${pts.join(" L ")}`
  const baseY = PAD.top + PLOT_H
  const areaPath = `${linePath} L ${toX(maxDist)},${baseY} L ${toX(0)},${baseY} Z`

  const gradId = "elev-fill"

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      style={{ width: "100%", height: "5rem" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACTIVITY_COLOR} stopOpacity={0.3} />
          <stop offset="100%" stopColor={ACTIVITY_COLOR} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* area fill */}
      <path d={areaPath} fill={`url(#${gradId})`} />

      {/* elevation line */}
      <path
        d={linePath}
        fill="none"
        stroke={ACTIVITY_COLOR}
        strokeWidth={1.5}
      />

      {/* y-axis labels */}
      <text
        x={PAD.left - 3}
        y={PAD.top + 4}
        textAnchor="end"
        fontSize={8}
        fill="currentColor"
        opacity={0.5}
      >
        {Math.round(maxEle)}
      </text>
      <text
        x={PAD.left - 3}
        y={PAD.top + PLOT_H}
        textAnchor="end"
        fontSize={8}
        fill="currentColor"
        opacity={0.5}
      >
        {Math.round(minEle)}
      </text>

      {/* x-axis labels */}
      <text
        x={PAD.left}
        y={H - 2}
        textAnchor="start"
        fontSize={8}
        fill="currentColor"
        opacity={0.5}
      >
        0
      </text>
      <text
        x={W - PAD.right}
        y={H - 2}
        textAnchor="end"
        fontSize={8}
        fill="currentColor"
        opacity={0.5}
      >
        {maxDist.toFixed(1)}km
      </text>
    </svg>
  )
}
