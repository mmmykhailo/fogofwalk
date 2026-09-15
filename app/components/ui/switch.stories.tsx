import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { StatefulStory } from "../../../.storybook/decorators/StatefulStory"
import { Switch } from "./switch"

const meta = {
  title: "UI/Switch",
  component: Switch,
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = {
  render: () => <Switch aria-label="Use fill mode" />,
}

export const On: Story = {
  render: () => <Switch aria-label="Use fill mode" defaultChecked />,
}

export const Disabled: Story = {
  render: () => <Switch aria-label="Sync enabled" disabled />,
}

export const LabelledSetting: Story = {
  render: () => (
    <label className="flex items-center justify-between gap-6 text-xs">
      <span>
        Clear interiors
        <span className="block text-muted-foreground">
          Fill enclosed loops as well as the route corridor.
        </span>
      </span>
      <Switch aria-label="Clear interiors" />
    </label>
  ),
}

export const KeyboardToggle: Story = {
  render: () => {
    const onCheckedChange = fn()
    return (
      <StatefulStory initialValue={false} onChange={onCheckedChange}>
        {(checked, setChecked) => (
          <Switch
            aria-label="Show photos"
            checked={checked}
            onCheckedChange={setChecked}
          />
        )}
      </StatefulStory>
    )
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole("switch", { name: "Show photos" })
    await userEvent.click(toggle)
    await expect(toggle).toBeChecked()
    await userEvent.keyboard(" ")
    await expect(toggle).not.toBeChecked()
  },
}
