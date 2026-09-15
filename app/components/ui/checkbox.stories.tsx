import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { StatefulStory } from "../../../.storybook/decorators/StatefulStory"
import { Checkbox } from "./checkbox"

const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  render: () => <Checkbox aria-label="Include photos" />,
}

export const Checked: Story = {
  render: () => <Checkbox aria-label="Include photos" defaultChecked />,
}

export const Indeterminate: Story = {
  render: () => (
    <Checkbox aria-label="Select all activities" indeterminate checked />
  ),
}

export const Disabled: Story = {
  render: () => (
    <Checkbox aria-label="Sync activities" defaultChecked disabled />
  ),
}

export const LabelledField: Story = {
  render: () => (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox aria-describedby="photo-help" aria-label="Include photos" />
      <span>
        Include photos
        <span id="photo-help" className="block text-muted-foreground">
          Keep matching photos in the map library.
        </span>
      </span>
    </label>
  ),
}

export const KeyboardToggle: Story = {
  render: () => {
    const onCheckedChange = fn()
    return (
      <StatefulStory initialValue={false} onChange={onCheckedChange}>
        {(checked, setChecked) => (
          <Checkbox
            aria-label="Show cleared routes"
            checked={checked}
            onCheckedChange={setChecked}
          />
        )}
      </StatefulStory>
    )
  },
  play: async ({ canvas }) => {
    const checkbox = canvas.getByRole("checkbox", {
      name: "Show cleared routes",
    })
    await userEvent.click(checkbox)
    await expect(checkbox).toBeChecked()
    await userEvent.keyboard(" ")
    await expect(checkbox).not.toBeChecked()
  },
}
