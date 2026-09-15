import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { makeActivitySummary } from "../../../.storybook/fixtures/activities"

import { ActivitySettingsControls } from "./ActivitySettingsControls"

const meta = {
  title: "Activities/ActivitySettingsControls",
  component: ActivitySettingsControls,
  args: {
    activity: makeActivitySummary(),
    canEditVisibility: false,
    visibilityDisabledDescription: "Visibility editing requires sync access.",
  },
  parameters: {
    layout: "padded",
    actionResult: {
      ok: true,
      operationId: "storybook-operation",
      revision: 2,
      coverageRevision: 2,
      updated: [],
    },
  },
} satisfies Meta<typeof ActivitySettingsControls>

export default meta
type Story = StoryObj<typeof meta>

const disabledDescription = "Visibility editing requires sync access."

export const PrivateWalk: Story = {
  render: () => (
    <ActivitySettingsControls
      activity={makeActivitySummary({ id: "settings-walk", activityType: "walking" })}
      canEditVisibility
      visibilityDisabledDescription={disabledDescription}
    />
  ),
}

export const PublicRide: Story = {
  render: () => (
    <ActivitySettingsControls
      activity={makeActivitySummary({
        id: "settings-ride",
        name: "City ride.fit",
        activityType: "cycling",
        isPublic: true,
      })}
      canEditVisibility
      visibilityDisabledDescription={disabledDescription}
    />
  ),
}

export const UnsyncedAndDisabled: Story = {
  render: () => (
    <ActivitySettingsControls
      activity={makeActivitySummary({
        id: "settings-unsynced",
        contentHash: undefined,
      })}
      canEditVisibility={false}
      visibilityDisabledDescription={disabledDescription}
    />
  ),
}

const onOptimisticChange = fn()
const onSuccess = fn()

export const CompleteMetadataCallbacks: Story = {
  render: () => (
    <ActivitySettingsControls
      activity={makeActivitySummary({ id: "settings-callbacks" })}
      canEditVisibility
      visibilityDisabledDescription={disabledDescription}
      onOptimisticChange={onOptimisticChange}
      onSuccess={onSuccess}
    />
  ),
  play: async ({ canvas }) => {
    const typeSelect = await canvas.findByRole("combobox", {
      name: "Activity type for Riverside loop",
    })
    await userEvent.click(typeSelect)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Running" })
    )
    await expect(onOptimisticChange).toHaveBeenCalledWith({
      isPublic: false,
      activityType: "running",
    })
  },
}
