import type { Meta, StoryObj } from "@storybook/react-vite"

import { Separator } from "./separator"

const meta = {
  title: "UI/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="w-full max-w-md space-y-3 text-xs">
      <span>Activities</span>
      <Separator />
      <span>Saved points</span>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-3 text-xs">
      <span>Map</span>
      <Separator orientation="vertical" />
      <span>Stats</span>
    </div>
  ),
}

export const Semantic: Story = {
  render: () => <Separator aria-label="Section boundary" />,
}

export const Decorative: Story = {
  render: () => <Separator aria-hidden="true" />,
}
