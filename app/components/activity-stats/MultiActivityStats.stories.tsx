import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { makeParsedActivity } from "../../../.storybook/fixtures/activities"
import { computeCompositeStats } from "~/lib/shareCard"

import { MultiActivityStats } from "./MultiActivityStats"

const meta = {
  title: "Activity statistics/MultiActivityStats",
  component: MultiActivityStats,
  args: {
    activities: [],
    composite: {
      totalDistanceKm: 0,
      totalElevationGainM: 0,
      totalElevationLossM: 0,
      hasElevation: false,
      totalDurationMs: null,
      totalMovingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingSpeedKmh: null,
      totalUniqueKm: 0,
      activityCount: 0,
    },
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof MultiActivityStats>

export default meta
type Story = StoryObj<typeof meta>

const twoActivities = [
  makeParsedActivity({ id: "multi-one", name: "Morning loop" }),
  makeParsedActivity({
    id: "multi-two",
    name: "Evening ride.fit",
    activityType: "cycling",
    stats: { distanceKm: 18.2, uniqueDistanceKm: 11.4 },
  }),
]

export const TwoActivities: Story = {
  render: () => (
    <MultiActivityStats
      activities={twoActivities}
      composite={computeCompositeStats(twoActivities)}
    />
  ),
}

export const ManyActivities: Story = {
  render: () => {
    const activities = Array.from({ length: 6 }, (_, index) =>
      makeParsedActivity({
        id: `multi-${index + 1}`,
        name: `Activity ${index + 1}`,
        stats: { distanceKm: 4 + index * 1.5 },
      })
    )
    return (
      <MultiActivityStats
        activities={activities}
        composite={computeCompositeStats(activities)}
      />
    )
  },
}

export const MissingOptionalValues: Story = {
  render: () => {
    const activities = [
      makeParsedActivity({ id: "multi-sparse", startedAtMs: null }),
      makeParsedActivity({
        id: "multi-untimed",
        stats: {
          durationMs: null,
          movingTimeMs: null,
          avgMovingSpeedKmh: null,
          hasElevation: false,
          elevationGainM: 0,
          elevationLossM: 0,
          elevationProfile: [],
        },
      }),
    ]
    return (
      <MultiActivityStats
        activities={activities}
        composite={computeCompositeStats(activities)}
      />
    )
  },
}

const onRemoveActivity = fn()

export const RemoveRowReportsExactId: Story = {
  render: () => (
    <MultiActivityStats
      activities={twoActivities}
      composite={computeCompositeStats(twoActivities)}
      onRemoveActivity={onRemoveActivity}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Remove Evening ride.fit" })
    )
    await expect(onRemoveActivity).toHaveBeenCalledWith("multi-two")
  },
}
