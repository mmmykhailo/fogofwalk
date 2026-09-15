import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { Button } from "./button"

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

const variants = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const

const sizes = [
  "default",
  "xs",
  "sm",
  "lg",
  "icon-xs",
  "icon-sm",
  "icon",
  "icon-lg",
] as const

export const Default: Story = {
  args: {
    children: "Explore the map",
    onClick: fn(),
  },
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {variants.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant[0].toUpperCase() + variant.slice(1)}
        </Button>
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {sizes.map((size) => (
        <Button
          key={size}
          size={size}
          aria-label={size.startsWith("icon") ? `${size} action` : undefined}
        >
          {size.startsWith("icon") ? <CheckIcon /> : size}
        </Button>
      ))}
    </div>
  ),
}

export const IconPlacement: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <DownloadSimpleIcon data-icon="inline-start" />
        Import activity
      </Button>
      <Button variant="outline">
        Continue
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Go back">
        <ArrowLeftIcon />
      </Button>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Disabled</Button>
      <Button aria-invalid="true">
        <WarningCircleIcon data-icon="inline-start" />
        Invalid
      </Button>
      <Button disabled aria-invalid="true">
        Disabled invalid
      </Button>
    </div>
  ),
}

export const AsLink: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="link" render={<a href="/activities" />}>
        Open activity library
      </Button>
      <Button variant="outline" render={<a href="/stats" />}>
        View statistics
      </Button>
    </div>
  ),
}

export const Interaction: Story = {
  args: { onClick: fn() },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args}>Save changes</Button>
      <Button disabled onClick={args.onClick}>
        Disabled action
      </Button>
    </div>
  ),
  play: async ({ canvas, args }) => {
    const save = canvas.getByRole("button", { name: "Save changes" })
    const disabled = canvas.getByRole("button", { name: "Disabled action" })
    await userEvent.tab()
    await expect(save).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(args.onClick).toHaveBeenCalledTimes(1)
    await userEvent.click(disabled)
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}
