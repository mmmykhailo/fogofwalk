import { useState } from "react"
import { InfoIcon, MapPinIcon } from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const TextTrigger: Story = {
  render: () => <TooltipExample label="Show activity details" />,
}

export const IconTrigger: Story = {
  render: () => (
    <TooltipExample
      label="Saved point information"
      icon
      trigger={<MapPinIcon />}
    />
  ),
}

export const EachSide: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-10 p-16">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger render={<Button variant="outline" />}>
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>Tooltip on the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const Multiline: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Fog information" />
        }
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent>
        Fog clears around every imported route.
        <br />
        Closed loops also clear their interior in Fill mode.
      </TooltipContent>
    </Tooltip>
  ),
}

export const HoverAndFocus: Story = {
  render: () => <TooltipExample label="Reveal help" openOnFocus />,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Reveal help" })
    await userEvent.hover(trigger)
    await waitFor(() => {
      expect(within(document.body).getByText("Helpful context")).toBeVisible()
    })
    await userEvent.unhover(trigger)
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).getByText("Helpful context")).toBeVisible()
    })
    await userEvent.keyboard("{Escape}")
    await userEvent.tab()
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("tooltip")
      ).not.toBeInTheDocument()
    )
  },
}

function TooltipExample({
  label,
  icon = false,
  trigger,
  openOnFocus = false,
}: {
  label: string
  icon?: boolean
  trigger?: React.ReactNode
  openOnFocus?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Tooltip {...(openOnFocus ? { open, onOpenChange: setOpen } : undefined)}>
      <TooltipTrigger
        onFocus={openOnFocus ? () => setOpen(true) : undefined}
        onBlur={openOnFocus ? () => setOpen(false) : undefined}
        render={
          <Button
            variant={icon ? "ghost" : "outline"}
            size={icon ? "icon" : "default"}
            aria-label={label}
          />
        }
      >
        {trigger ?? label}
      </TooltipTrigger>
      <TooltipContent aria-label="Helpful context">
        Helpful context
      </TooltipContent>
    </Tooltip>
  )
}
