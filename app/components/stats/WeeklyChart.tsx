import { BarChart, Bar, XAxis, YAxis } from "recharts"
import type { WeeklyBar } from "~/lib/statsAggregator"
import { formatXAxisTick } from "~/lib/statsFormatters"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "~/components/ui/chart"
import { WeekTooltip } from "~/components/stats/WeekTooltip"

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  distanceKm: {
    label: "Distance",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

interface WeeklyChartProps {
  weekly: WeeklyBar[]
}

export function WeeklyChart({ weekly }: WeeklyChartProps) {
  if (weekly.length === 0) return null

  const xTickInterval = Math.max(0, Math.ceil(weekly.length / 12) - 1)
  const chartMinWidth = Math.max(500, weekly.length * 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly distance (km)</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="overflow-x-auto">
          <div style={{ minWidth: chartMinWidth }}>
            <ChartContainer config={chartConfig} className="h-44 w-full">
              <BarChart
                data={weekly}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                barCategoryGap="20%"
              >
                <XAxis
                  dataKey="startMs"
                  tickFormatter={formatXAxisTick}
                  interval={xTickInterval}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <ChartTooltip content={<WeekTooltip />} />
                <Bar
                  dataKey="distanceKm"
                  fill="var(--color-distanceKm)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
