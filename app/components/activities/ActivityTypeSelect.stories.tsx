import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { ActivityTypeSelect } from "./ActivityTypeSelect"
import type { ActivityType } from "~/types/activities"

const meta = {
  title: "Activities/ActivityTypeSelect",
  component: ActivityTypeSelect,
  args: { onChange: () => {} },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivityTypeSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Unset: Story = {
  args: { onChange: fn(), ariaLabel: "Activity type" },
}

export const EachActivityType: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["walking", "running", "cycling", "kayaking", "swimming", "other"] as const).map(
        (activityType) => (
          <ActivityTypeSelect
            key={activityType}
            activityType={activityType}
            onChange={() => {}}
            ariaLabel={`${activityType} activity type`}
          />
        )
      )}
    </div>
  ),
}

export const MixedBulkValue: Story = {
  args: {
    mixed: true,
    onChange: fn(),
    ariaLabel: "Activity type for selected activities",
  },
}

export const Disabled: Story = {
  args: {
    activityType: "walking",
    disabled: true,
    onChange: fn(),
    ariaLabel: "Disabled activity type",
  },
}

const onChange = fn()

export const SelectsAndReportsType: Story = {
  render: () => <ActivityTypeHarness />,
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("combobox", {
      name: "Editable activity type",
    })
    await userEvent.click(trigger)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Kayaking" })
    )
    await expect(onChange).toHaveBeenCalledWith("kayaking")
    await expect(trigger).toHaveTextContent("Kayaking")
  },
}

function ActivityTypeHarness() {
  const [activityType, setActivityType] = useState<ActivityType | undefined>()

  return (
    <ActivityTypeSelect
      activityType={activityType}
      onChange={(value) => {
        onChange(value)
        setActivityType(value ?? undefined)
      }}
      ariaLabel="Editable activity type"
    />
  )
}
