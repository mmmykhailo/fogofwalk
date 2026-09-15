import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { makeActivitySummary } from "../../../.storybook/fixtures/activities"

import { ActivitiesGrid } from "./ActivitiesGrid"

const meta = {
  title: "Activities/ActivitiesGrid",
  component: ActivitiesGrid,
  args: {
    activities: [makeActivitySummary()],
    selectedActivityIds: new Set<string>(),
    onSelectionChange: () => {},
    showActivitySettings: false,
    canEditVisibility: false,
    visibilityDisabledDescription: "Visibility editing requires sync access.",
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivitiesGrid>

export default meta
type Story = StoryObj<typeof meta>

const visibilityDescription = "Visibility editing requires sync access."

export const TypicalCards: Story = {
  render: () => (
    <ActivitiesGrid
      activities={[
        makeActivitySummary({ id: "grid-walk", name: "Riverside walk.gpx" }),
        makeActivitySummary({
          id: "grid-ride",
          name: "City ride.fit",
          activityType: "cycling",
          isPublic: true,
        }),
        makeActivitySummary({
          id: "grid-untimed",
          name: "Untimed route.gpx",
          startedAtMs: null,
          stats: {
            durationMs: null,
            avgMovingSpeedKmh: null,
            elevationGainM: 0,
          },
        }),
      ]}
      selectedActivityIds={new Set()}
      onSelectionChange={() => {}}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription={visibilityDescription}
    />
  ),
}

export const OneCard: Story = {
  render: () => (
    <ActivitiesGrid
      activities={[makeActivitySummary({ id: "grid-one" })]}
      selectedActivityIds={new Set(["grid-one"])}
      onSelectionChange={() => {}}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription={visibilityDescription}
    />
  ),
}

export const LongNamesAndIndependentSelection: Story = {
  render: () => (
    <ActivitiesGrid
      activities={[
        makeActivitySummary({
          id: "grid-long",
          name: "A very long imported activity name that should stay within its own card.fit",
        }),
        makeActivitySummary({ id: "grid-second", name: "Second route.gpx" }),
      ]}
      selectedActivityIds={new Set()}
      onSelectionChange={onSelectionChange}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription={visibilityDescription}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: /long imported activity/i })
    )
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: /Second route/i })
    )
    await expect(onSelectionChange).toHaveBeenNthCalledWith(
      1,
      "grid-long",
      true
    )
    await expect(onSelectionChange).toHaveBeenNthCalledWith(
      2,
      "grid-second",
      true
    )
  },
}

const onSelectionChange = fn()
