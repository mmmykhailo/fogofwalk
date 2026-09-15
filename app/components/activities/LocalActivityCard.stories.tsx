import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent, within } from "storybook/test"

import { makeActivitySummary } from "../../../.storybook/fixtures/activities"
import { useAuth } from "~/lib/server/authStore"

import { LocalActivityCard } from "./LocalActivityCard"

const meta = {
  title: "Activities/LocalActivityCard",
  component: LocalActivityCard,
  args: {
    activity: makeActivitySummary(),
    isSelected: false,
    showActivitySettings: false,
    canEditVisibility: false,
    visibilityDisabledDescription: "Visibility editing requires sync access.",
    onSelectionChange: () => {},
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
} satisfies Meta<typeof LocalActivityCard>

export default meta
type Story = StoryObj<typeof meta>

const onSelectionChange = fn()

export const Unselected: Story = {
  render: () => (
    <LocalActivityCard
      activity={makeActivitySummary({ id: "local-unselected" })}
      isSelected={false}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription="Visibility editing requires sync access."
      onSelectionChange={onSelectionChange}
    />
  ),
}

export const Selected: Story = {
  render: () => (
    <LocalActivityCard
      activity={makeActivitySummary({ id: "local-selected", isPublic: true })}
      isSelected
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription="Visibility editing requires sync access."
      onSelectionChange={onSelectionChange}
    />
  ),
}

export const SettingsHidden: Story = {
  render: () => (
    <LocalActivityCard
      activity={makeActivitySummary({ id: "local-hidden-settings" })}
      isSelected={false}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription="Select an activity to edit it."
      onSelectionChange={onSelectionChange}
    />
  ),
}

export const EditablePublicAndTypeSettings: Story = {
  render: () => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: {
        id: "fixture-user",
        displayName: "Alex Trail",
        avatarUrl: null,
        handle: "alex-trail",
        provider: "github",
        status: "allowed",
      },
      canSync: true,
      isAdmin: false,
    })
    return (
      <LocalActivityCard
        activity={makeActivitySummary({
          id: "local-editable",
          activityType: "cycling",
          isPublic: true,
        })}
        isSelected={false}
        showActivitySettings
        canEditVisibility
        visibilityDisabledDescription="Visibility editing requires sync access."
        onSelectionChange={onSelectionChange}
      />
    )
  },
  play: async ({ canvas }) => {
    const typeSelect = await canvas.findByRole("combobox", {
      name: "Activity type for Riverside loop",
    })
    await userEvent.click(typeSelect)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Running" })
    )
    await expect(typeSelect).toHaveTextContent(/running/i)
  },
}

export const VisibilityDisabledWithExplanation: Story = {
  render: () => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: {
        id: "fixture-user",
        displayName: "Pending Trail",
        avatarUrl: null,
        handle: "pending-trail",
        provider: "github",
        status: "pending",
      },
      canSync: false,
      isAdmin: false,
    })
    return (
      <LocalActivityCard
        activity={makeActivitySummary({ id: "local-pending" })}
        isSelected={false}
        showActivitySettings
        canEditVisibility={false}
        visibilityDisabledDescription="Visibility editing requires sync access."
        onSelectionChange={onSelectionChange}
      />
    )
  },
}

export const SelectionReportsActivityId: Story = {
  render: () => (
    <LocalActivityCard
      activity={makeActivitySummary({ id: "local-selection" })}
      isSelected={false}
      showActivitySettings={false}
      canEditVisibility={false}
      visibilityDisabledDescription="Visibility editing requires sync access."
      onSelectionChange={onSelectionChange}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("checkbox", { name: /Select activity/i })
    )
    await expect(onSelectionChange).toHaveBeenCalledWith(
      "local-selection",
      true
    )
  },
}
