import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"

import {
  makeLifetimeTotals,
  makePersonalRecords,
  makeStreaks,
  makeWeeklyBars,
} from "../../../.storybook/fixtures/stats"
import { makeParsedActivity } from "../../../.storybook/fixtures/activities"

import { PersonalRecordsCard } from "./PersonalRecordsCard"
import { StatCards } from "./StatCards"
import { StreaksCard } from "./StreaksCard"
import { WeeklyChart } from "./WeeklyChart"

const meta = {
  title: "Statistics/Stats cards and charts",
  component: StatCards,
  args: { totals: makeLifetimeTotals() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof StatCards>

export default meta
type Story = StoryObj<typeof meta>

export const ZeroTotals: Story = {
  args: {
    totals: makeLifetimeTotals({
      totalDistanceKm: 0,
      totalElevationGainM: 0,
      totalMovingTimeMs: 0,
      totalActivities: 0,
      activeDays: 0,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Distance")).toBeVisible()
    await expect(canvas.getAllByText("0.0 km")).toHaveLength(2)
    await expect(canvas.getAllByText("—")).toHaveLength(5)
  },
}

export const TypicalPrivateTotalsWithUniqueDistance: Story = {
  args: {
    totals: makeLifetimeTotals(),
    uniqueDistanceKm: 143.2,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unique distance")).toBeVisible()
    await expect(canvas.getByText("143.2 km")).toBeVisible()
  },
}

export const PublicTotalsWithoutUniqueDistance: Story = {
  args: {
    totals: makeLifetimeTotals({
      totalDistanceKm: 96.4,
      totalElevationGainM: 1_680,
      totalMovingTimeMs: 28_800_000,
      totalActivities: 12,
      activeDays: 10,
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Unique distance")).not.toBeInTheDocument()
    await expect(canvas.getByText("96.4 km")).toBeVisible()
  },
}

export const LargeValues: Story = {
  args: {
    totals: makeLifetimeTotals({
      totalDistanceKm: 12_345.6,
      totalElevationGainM: 12_800,
      totalMovingTimeMs: 360 * 3_600_000,
      totalActivities: 1_024,
      activeDays: 512,
    }),
    uniqueDistanceKm: 9_876.5,
  },
}

export const WeeklySingleWeek: Story = {
  render: () => (
    <div className="w-full max-w-2xl" style={{ width: 640 }}>
      <WeeklyChart weekly={makeWeeklyBars(1)} />
    </div>
  ),
}

export const WeeklyTwelveWeeks: Story = {
  render: () => (
    <div className="w-full max-w-2xl" style={{ width: 640 }}>
      <WeeklyChart weekly={makeWeeklyBars(12)} />
    </div>
  ),
}

export const WeeklyScrollable: Story = {
  render: () => (
    <div className="w-full max-w-2xl" style={{ width: 640 }}>
      <WeeklyChart weekly={makeWeeklyBars(60)} />
    </div>
  ),
}

export const WeeklyZeroDistanceWeeks: Story = {
  render: () => (
    <div className="w-full max-w-2xl" style={{ width: 640 }}>
      <WeeklyChart
        weekly={makeWeeklyBars(4, { distanceKm: 0, activityCount: 0 })}
      />
    </div>
  ),
}

export const WeeklyTooltip: Story = {
  render: () => (
    <div className="w-full max-w-2xl" style={{ width: 640 }}>
      <WeeklyChart weekly={makeWeeklyBars(4)} />
    </div>
  ),
  play: async ({ canvas, canvasElement }) => {
    let surface: Element | null = null
    await waitFor(() => {
      surface = canvasElement.querySelector(".recharts-surface")
      expect(surface).toBeTruthy()
    })
    if (!surface) throw new Error("Expected a rendered weekly chart surface")
    let bar: Element | null = null
    await waitFor(() => {
      bar = canvasElement.querySelector(".recharts-rectangle")
      expect(bar).toBeTruthy()
    })
    if (!bar) throw new Error("Expected a rendered weekly chart bar")
    const bounds = bar.getBoundingClientRect()
    await fireEvent.mouseMove(surface, {
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    })
    await waitFor(() =>
      expect(within(document.body).getByText("12.4 km")).toBeVisible()
    )
    await expect(within(document.body).getByText("Distance")).toBeVisible()
    await expect(within(document.body).getByText("Activities")).toBeVisible()
  },
}

export const WeeklyEmpty: Story = {
  render: () => <WeeklyChart weekly={[]} />,
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByText("Weekly distance (km)")
    ).not.toBeInTheDocument()
  },
}

export const ActiveStreak: Story = {
  render: () => <StreaksCard streaks={makeStreaks()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("6")).toBeVisible()
    await expect(canvas.getByText("18")).toBeVisible()
    await expect(
      canvas.getByLabelText("Activity over the last 12 weeks")
    ).toBeVisible()
  },
}

export const BrokenStreak: Story = {
  render: () => (
    <StreaksCard
      streaks={makeStreaks({
        currentStreakDays: 0,
        longestStreakDays: 18,
        thisWeekKm: 0,
        lastWeekKm: 34.8,
        activeInWindowCount: 23,
      })}
    />
  ),
}

export const NoRecentActivity: Story = {
  render: () => (
    <StreaksCard
      streaks={makeStreaks({
        currentStreakDays: 0,
        longestStreakDays: 0,
        recentDays: [],
        thisWeekKm: 0,
        lastWeekKm: 0,
        activeInWindowCount: 0,
      })}
    />
  ),
}

export const DenseEightyFourDayCalendar: Story = {
  render: () => (
    <StreaksCard
      streaks={makeStreaks({
        recentDays: [
          "2026-06-23",
          "2026-06-24",
          "2026-06-25",
          "2026-06-26",
          "2026-06-27",
          "2026-06-28",
          "2026-06-29",
          "2026-07-01",
          "2026-07-08",
          "2026-07-15",
          "2026-07-22",
          "2026-07-29",
          "2026-08-05",
          "2026-08-12",
          "2026-08-19",
          "2026-08-26",
          "2026-09-02",
          "2026-09-09",
          "2026-09-15",
        ],
        activeInWindowCount: 19,
      })}
    />
  ),
}

export const AllPersonalRecords: Story = {
  render: () => <PersonalRecordsCard records={makePersonalRecords()} />,
}

export const PartialPersonalRecords: Story = {
  render: () => (
    <PersonalRecordsCard
      records={makePersonalRecords({
        fastestPace: null,
        fastestAvgSpeed: null,
      })}
    />
  ),
}

export const NoPersonalRecords: Story = {
  render: () => (
    <PersonalRecordsCard
      records={makePersonalRecords({
        longestActivity: null,
        mostElevation: null,
        fastestPace: null,
        fastestAvgSpeed: null,
        longestMovingTime: null,
      })}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No data yet.")).toBeVisible()
  },
}

export const SeveralRecordsFromOneActivity: Story = {
  render: () => {
    const activity = makeParsedActivity({
      id: "record-shared-activity",
      name: "One very good route",
    })
    return (
      <PersonalRecordsCard
        records={makePersonalRecords({
          longestActivity: { activity, distanceKm: 42.2 },
          mostElevation: { activity, elevationGainM: 1_240 },
          fastestPace: { activity, paceMinPerKm: 4.25 },
          fastestAvgSpeed: { activity, avgSpeedKmh: 28.4 },
          longestMovingTime: { activity, movingTimeMs: 6 * 3_600_000 },
        })}
      />
    )
  },
}
