import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer"

const meta = {
  title: "UI/Drawer",
  component: Drawer,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const BottomMobile: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  render: () => <DrawerExample />,
}

export const RightDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <DrawerExample direction="right" />,
}

export const HeaderBodyFooter: Story = {
  render: () => (
    <DrawerExample
      initiallyOpen
      title="Map controls"
      description="Adjust the map without leaving the current activity."
      footer
    />
  ),
}

export const ScrollableBody: Story = {
  render: () => (
    <DrawerExample
      initiallyOpen
      title="Activity library"
      body={Array.from(
        { length: 14 },
        (_, index) => `Activity ${index + 1} · ${index + 3}.4 km`
      )}
    />
  ),
}

export const FocusRestoration: Story = {
  render: () => <DrawerExample />,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Open drawer" })
    await userEvent.click(trigger)
    const drawer = within(document.body).getByRole("dialog")
    await expect(drawer).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => {
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    })
    await expect(trigger).toHaveFocus()
  },
}

function DrawerExample({
  direction = "bottom",
  initiallyOpen = false,
  title = "Saved points",
  description = "Your saved points stay on this device unless you enable sync.",
  footer = false,
  body,
}: {
  direction?: "bottom" | "right"
  initiallyOpen?: boolean
  title?: string
  description?: string
  footer?: boolean
  body?: string[]
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <Drawer
      direction={direction}
      open={open}
      onOpenChange={setOpen}
      disablePreventScroll
    >
      <DrawerTrigger>Open drawer</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {(body ?? ["North gate", "River bend", "Old forest"]).map((item) => (
            <p key={item} className="border border-border p-2">
              {item}
            </p>
          ))}
        </div>
        {footer && (
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Close drawer</Button>
            </DrawerClose>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
