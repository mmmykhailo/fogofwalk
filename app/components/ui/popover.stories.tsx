import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover"

const meta = {
  title: "UI/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const TriggerClosed: Story = {
  render: () => <PopoverExample />,
}

export const DefaultOpen: Story = {
  render: () => <PopoverExample defaultOpen />,
}

export const TitledAndAligned: Story = {
  render: () => (
    <PopoverExample
      defaultOpen
      align="end"
      title="Route details"
      description="The popup is aligned to the trailing edge of its trigger."
    />
  ),
}

export const KeyboardAndDismissal: Story = {
  render: () => <PopoverExample />,
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("button", { name: "Show details" })
    await userEvent.click(trigger)
    await expect(within(document.body).getByRole("dialog")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => {
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    })
    await expect(trigger).toHaveFocus()
  },
}

function PopoverExample({
  defaultOpen = false,
  align = "center",
  title = "Saved point",
  description = "Coordinates are stored with this point.",
}: {
  defaultOpen?: boolean
  align?: "center" | "start" | "end"
  title?: string
  description?: string
}) {
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        Show details
      </PopoverTrigger>
      <PopoverContent align={align}>
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        <p className="text-muted-foreground">7.4211° N, 24.1180° E</p>
      </PopoverContent>
    </Popover>
  )
}
