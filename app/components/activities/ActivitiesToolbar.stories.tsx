import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import {
  MIXED_ACTIVITY_TYPE,
  MIXED_VISIBILITY,
} from "~/lib/activitySettings"

import { ActivitiesToolbar } from "./ActivitiesToolbar"

const meta = {
  title: "Activities/ActivitiesToolbar",
  component: ActivitiesToolbar,
  args: {
    hasSelection: false,
    selectedActivityCount: 0,
    visibility: false,
    activityType: "no-activity-selection",
    canEditVisibility: false,
    visibilityDisabledDescription: "Visibility editing requires sync access.",
    isSubmitting: false,
    isCurrentPageFullySelected: false,
    isSelectionDisabled: false,
    sortOption: "date",
    onSortChange: () => {},
    onSelectAll: () => {},
    onPublicityChange: () => {},
    onActivityTypeChange: () => {},
    onClearSelection: () => {},
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivitiesToolbar>

export default meta
type Story = StoryObj<typeof meta>

const commonProps = {
  visibilityDisabledDescription: "Visibility editing requires sync access.",
  isSubmitting: false,
  isSelectionDisabled: false,
}

export const NoSelection: Story = {
  render: () => (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection={false}
      selectedActivityCount={0}
      visibility={false}
      activityType="no-activity-selection"
      canEditVisibility={false}
      isCurrentPageFullySelected={false}
      sortOption="date"
      onSortChange={() => {}}
      onSelectAll={() => {}}
      onPublicityChange={() => {}}
      onActivityTypeChange={() => {}}
      onClearSelection={() => {}}
    />
  ),
}

export const OneSelected: Story = {
  render: () => (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection
      selectedActivityCount={1}
      visibility={false}
      activityType="walking"
      canEditVisibility
      isCurrentPageFullySelected
      sortOption="date"
      onSortChange={() => {}}
      onSelectAll={() => {}}
      onPublicityChange={() => {}}
      onActivityTypeChange={() => {}}
      onClearSelection={() => {}}
    />
  ),
}

export const MixedSelection: Story = {
  render: () => (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection
      selectedActivityCount={4}
      visibility={MIXED_VISIBILITY}
      activityType={MIXED_ACTIVITY_TYPE}
      canEditVisibility
      isCurrentPageFullySelected={false}
      sortOption="distance"
      onSortChange={() => {}}
      onSelectAll={() => {}}
      onPublicityChange={() => {}}
      onActivityTypeChange={() => {}}
      onClearSelection={() => {}}
    />
  ),
}

export const EditDisabledWhileSubmitting: Story = {
  render: () => (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection
      selectedActivityCount={2}
      visibility={true}
      activityType="cycling"
      canEditVisibility={false}
      isSubmitting
      isSelectionDisabled
      isCurrentPageFullySelected={true}
      sortOption="date"
      onSortChange={() => {}}
      onSelectAll={() => {}}
      onPublicityChange={() => {}}
      onActivityTypeChange={() => {}}
      onClearSelection={() => {}}
    />
  ),
}

const onSortChange = fn()
const onSelectAll = fn()
const onPublicityChange = fn()
const onActivityTypeChange = fn()
const onClearSelection = fn()

export const ActionsReportValues: Story = {
  render: () => (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection={false}
      selectedActivityCount={0}
      visibility={false}
      activityType="no-activity-selection"
      canEditVisibility={false}
      isCurrentPageFullySelected={false}
      sortOption="date"
      onSortChange={onSortChange}
      onSelectAll={onSelectAll}
      onPublicityChange={onPublicityChange}
      onActivityTypeChange={onActivityTypeChange}
      onClearSelection={onClearSelection}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Select all" }))
    await expect(onSelectAll).toHaveBeenCalledTimes(1)

    const sort = await canvas.findByRole("combobox", { name: "Sort by" })
    await userEvent.click(sort)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Distance" })
    )
    await expect(onSortChange).toHaveBeenCalledWith(
      "distance",
      expect.objectContaining({ reason: "item-press" })
    )
  },
}

export const SelectedActionsReportValues: Story = {
  render: () => <SelectedToolbarHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("combobox", {
        name: "Set visibility for selected activities",
      })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Public" })
    )
    await expect(onPublicityChange).toHaveBeenCalledWith(true)

    await userEvent.click(
      await canvas.findByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Running" })
    )
    await expect(onActivityTypeChange).toHaveBeenCalledWith("running")

    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear selection" })
    )
    await expect(onClearSelection).toHaveBeenCalledTimes(1)
  },
}

function SelectedToolbarHarness() {
  const [selected, setSelected] = useState(true)
  return (
    <ActivitiesToolbar
      {...commonProps}
      hasSelection={selected}
      selectedActivityCount={3}
      visibility={false}
      activityType="walking"
      canEditVisibility
      isCurrentPageFullySelected={false}
      sortOption="date"
      onSortChange={() => {}}
      onSelectAll={() => {}}
      onPublicityChange={onPublicityChange}
      onActivityTypeChange={onActivityTypeChange}
      onClearSelection={() => {
        setSelected(false)
        onClearSelection()
      }}
    />
  )
}
