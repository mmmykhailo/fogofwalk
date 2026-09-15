import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"

import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
} from "./chart"

const chartData = [
  { day: "Mon", distance: 4.2, elevation: 80 },
  { day: "Tue", distance: 7.4, elevation: 124 },
  { day: "Wed", distance: 2.1, elevation: 35 },
  { day: "Thu", distance: 9.8, elevation: 210 },
] as const

const chartConfig = {
  distance: { label: "Distance", color: "var(--chart-1)" },
  elevation: { label: "Elevation", color: "var(--chart-2)" },
} as const

const meta = {
  title: "UI/Chart",
  component: ChartContainer,
  args: { config: chartConfig, children: null },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ChartContainer>

export default meta
type Story = StoryObj<typeof meta>

export const LineWithTooltipAndLegend: Story = {
  render: () => (
    <div className="w-full max-w-2xl">
      <ChartContainer
        config={chartConfig}
        className="min-h-[240px] w-full"
        role="img"
        aria-label="Weekly activity chart"
      >
        <LineChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 8, right: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={28} />
          <Tooltip content={<ChartTooltipContent />} />
          <Legend content={<ChartLegendContent />} />
          <Line
            dataKey="distance"
            type="monotone"
            stroke="var(--color-distance)"
            dot
            isAnimationActive={false}
          />
          <Line
            dataKey="elevation"
            type="monotone"
            stroke="var(--color-elevation)"
            dot
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <p className="sr-only">
        Distance: Monday 4.2, Tuesday 7.4, Wednesday 2.1, Thursday 9.8
      </p>
    </div>
  ),
}

export const BarWithMultipleSeries: Story = {
  render: () => (
    <div className="w-full max-w-2xl">
      <ChartContainer
        config={chartConfig}
        className="min-h-[240px] w-full"
        role="img"
        aria-label="Distance and elevation bars"
      >
        <BarChart accessibilityLayer data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={28} />
          <Tooltip content={<ChartTooltipContent indicator="line" />} />
          <Bar
            dataKey="distance"
            fill="var(--color-distance)"
            radius={0}
            isAnimationActive={false}
          />
          <Bar
            dataKey="elevation"
            fill="var(--color-elevation)"
            radius={0}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <p className="sr-only">Distance and elevation are shown for four days.</p>
    </div>
  ),
}

export const TooltipDataIsAccessible: Story = {
  render: () => (
    <ChartContainer
      config={chartConfig}
      className="min-h-[240px] w-full max-w-xl"
      style={{ width: 640, height: 240 }}
      role="img"
      aria-label="Activity distance chart"
    >
      <LineChart accessibilityLayer data={chartData}>
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="distance"
          stroke="var(--color-distance)"
          dot
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  ),
  play: async ({ canvas, canvasElement }) => {
    const chart = canvas.getByRole("img", { name: "Activity distance chart" })
    await expect(chart).toBeVisible()
    let datum: Element | null = null
    await waitFor(() => {
      datum = canvasElement.querySelector(".recharts-line-dot")
      expect(datum).toBeTruthy()
    })
    if (!datum) throw new Error("Expected a rendered chart datum")
    const surface = canvasElement.querySelector(".recharts-surface")
    if (!surface) throw new Error("Expected a rendered chart surface")
    const bounds = surface.getBoundingClientRect()
    await fireEvent.mouseMove(surface, {
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    })
    await waitFor(() => {
      expect(within(document.body).getByText("Distance")).toBeVisible()
    })
  },
}
