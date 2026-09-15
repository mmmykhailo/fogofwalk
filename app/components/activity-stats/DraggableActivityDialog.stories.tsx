import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  expect,
  fireEvent,
  fn,
  mocked,
  userEvent,
  waitFor,
  within,
} from "storybook/test"

import {
  FIXTURE_ACTIVITY_START_MS,
  makeParsedActivity,
} from "../../../.storybook/fixtures/activities"
import { useCopyToClipboard } from "~/lib/useCopyToClipboard"

import { DraggableActivityDialog } from "./DraggableActivityDialog"

const meta = {
  title: "Activity statistics/DraggableActivityDialog",
  component: DraggableActivityDialog,
  args: { activities: [makeParsedActivity()], onClose: () => {} },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DraggableActivityDialog>

export default meta
type Story = StoryObj<typeof meta>

const baseActivity = makeParsedActivity({
  id: "dialog-activity",
  name: "Riverside loop",
  startedAtMs: FIXTURE_ACTIVITY_START_MS,
})

const secondActivity = makeParsedActivity({
  id: "dialog-second",
  name: "Evening ride.fit",
  activityType: "cycling",
  stats: { distanceKm: 18.2, uniqueDistanceKm: 11.4 },
})

const onClose = fn()
const onShare = fn()
const onDelete = fn()
const onCopy = fn()

export const DesktopSingleActivity: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => {
    mocked(useCopyToClipboard).mockReturnValue([false, onCopy])
    return (
      <DraggableActivityDialog
        activities={[baseActivity]}
        onClose={onClose}
        onShare={onShare}
        onDelete={onDelete}
      />
    )
  },
}

export const DesktopMultiSelect: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => {
    mocked(useCopyToClipboard).mockReturnValue([false, onCopy])
    return (
      <DraggableActivityDialog
        activities={[baseActivity, secondActivity]}
        onClose={onClose}
        onRemoveActivity={onRemoveActivity}
        onShare={onShare}
      />
    )
  },
}

export const PhoneDrawerWithFitLap: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  render: () => {
    mocked(useCopyToClipboard).mockReturnValue([false, onCopy])
    const activity = makeParsedActivity({
      ...baseActivity,
      id: "dialog-fit",
      format: "fit",
      laps: [
        {
          number: 1,
          startIndex: 0,
          endIndex: 1,
          startedAtMs: FIXTURE_ACTIVITY_START_MS,
          stats: {
            ...baseActivity.stats,
            distanceKm: 2.4,
            uniqueDistanceKm: 0,
          },
        },
        {
          number: 2,
          startIndex: 1,
          endIndex: 2,
          startedAtMs: FIXTURE_ACTIVITY_START_MS + 900_000,
          stats: {
            ...baseActivity.stats,
            distanceKm: 5,
            uniqueDistanceKm: 0,
          },
        },
      ],
    })
    return (
      <DraggableActivityDialog
        activities={[activity]}
        activeLap={activity.laps?.[1] ?? null}
        onLapSelect={onLapSelect}
        onClose={onClose}
        onShare={onShare}
      />
    )
  },
}

const onRemoveActivity = fn()
const onLapSelect = fn()

export const DesktopActionsAndDrag: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <DesktopInteractionHarness />,
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Copy activity name" }))
    await expect(onCopy).toHaveBeenCalledWith("Riverside loop")
    await userEvent.click(await canvas.findByRole("button", { name: "Share" }))
    await expect(onShare).toHaveBeenCalledTimes(1)

    const header = canvasElement.querySelector('[data-slot="card-header"]')
    if (!header) throw new Error("Expected a draggable activity header")
    const draggable = header.parentElement?.parentElement
    if (!draggable) throw new Error("Expected draggable activity container")
    await fireEvent.pointerDown(header, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 500,
      clientY: 120,
    })
    await fireEvent.pointerMove(header, {
      pointerId: 1,
      isPrimary: true,
      clientX: 540,
      clientY: 160,
    })
    await fireEvent.pointerUp(header, {
      pointerId: 1,
      isPrimary: true,
      clientX: 540,
      clientY: 160,
    })
    await waitFor(() =>
      expect((draggable as HTMLElement).style.transform).toContain("translate3d")
    )

    await userEvent.click(await canvas.findByRole("button", { name: "Delete activity" }))
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Delete" })
    )
    await expect(onDelete).toHaveBeenCalledWith(false)
  },
}

function DesktopInteractionHarness() {
  mocked(useCopyToClipboard).mockReturnValue([false, onCopy])
  return (
    <DraggableActivityDialog
      activities={[baseActivity]}
      onClose={onClose}
      onShare={onShare}
      onDelete={onDelete}
    />
  )
}
