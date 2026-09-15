import { CheckIcon, MapPinIcon } from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent } from "storybook/test"

import { Badge } from "./badge"

const meta = {
  title: "UI/Badge",
  component: Badge,
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

const variants = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
] as const

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {variants.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

export const WithIconAndLongLabel: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>
        <CheckIcon weight="bold" />
        Cleared
      </Badge>
      <Badge variant="outline">
        <MapPinIcon />
        Public saved point with a deliberately long descriptive label
      </Badge>
    </div>
  ),
}

export const Link: Story = {
  render: () => (
    <Badge
      variant="link"
      render={<a href="/activities">View activity library</a>}
    />
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "View activity library" })
    await expect(link).toHaveAttribute("href", "/activities")
    await userEvent.tab()
    await expect(link).toHaveFocus()
  },
}
