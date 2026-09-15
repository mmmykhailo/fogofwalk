import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"

import { makePublicActivity } from "../../../.storybook/fixtures/activities"

import { ActivityCard } from "./ActivityCard"
import { Button } from "../ui/button"
import { Checkbox } from "../ui/checkbox"

const meta = {
  title: "Activities/ActivityCard",
  component: ActivityCard,
  args: { activity: makePublicActivity() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivityCard>

export default meta
type Story = StoryObj<typeof meta>

export const CompleteMetrics: Story = {
  render: () => (
    <div className="w-full max-w-xl">
      <ActivityCard
        activity={makePublicActivity({
          name: "Riverside loop.gpx",
          startedAtMs: Date.parse("2026-09-15T06:30:00.000Z"),
        })}
        activityId="activity-card-complete"
        activityHref="/map?activity=activity-card-complete"
      />
    </div>
  ),
}

export const MissingOptionalMetrics: Story = {
  render: () => (
    <div className="w-full max-w-xl">
      <ActivityCard
        activity={makePublicActivity({
          name: "Undated route.fit",
          startedAtMs: null,
          durationMs: null,
          elevationGainM: 0,
          avgMovingSpeedKmh: null,
        })}
      />
    </div>
  ),
}

export const LongNameAndSettingsSlots: Story = {
  render: () => (
    <div className="w-full max-w-xl">
      <ActivityCard
        activity={makePublicActivity({
          name: "A very long imported activity name that remains readable after extension stripping.fit",
        })}
        activityHref="/map?activity=activity-long"
        selectionControl={
          <Checkbox aria-label="Select long activity" />
        }
        settingsControls={
          <Button size="sm" variant="outline">
            Settings
          </Button>
        }
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="More activity actions">
            ⋯
          </Button>
        }
      />
    </div>
  ),
}

const onAction = fn()

export const MapLinkAndIndependentActions: Story = {
  render: () => <ActivityCardNavigation onAction={onAction} />,
  play: async ({ canvas }) => {
    const action = await canvas.findByRole("button", { name: "Activity action" })
    await userEvent.click(action)
    await expect(onAction).toHaveBeenCalledTimes(1)
    await expect(canvas.getByTestId("activity-card-path")).toHaveTextContent(
      "/"
    )

    await userEvent.click(
      await canvas.findByRole("link", { name: "Morning loop" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("activity-card-path")).toHaveTextContent(
        "/map?activity=activity-navigation"
      )
    )
  },
}

function ActivityCardNavigation({ onAction }: { onAction: () => void }) {
  const location = useLocation()
  return (
    <>
      <ActivityCard
        activity={makePublicActivity({ name: "Morning loop.gpx" })}
        activityHref="/map?activity=activity-navigation"
        actions={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Activity action"
            onClick={onAction}
          >
            ⋯
          </Button>
        }
      />
      <output data-testid="activity-card-path" className="sr-only">
        {location.pathname + location.search}
      </output>
    </>
  )
}
