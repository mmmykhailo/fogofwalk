import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"

const meta = {
  title: "UI/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const TriggerClosed: Story = {
  render: () => <DialogExample />,
}

export const ControlledOpen: Story = {
  render: () => <DialogExample />,
}

export const DescriptionAndFooter: Story = {
  render: () => (
    <DialogExample
      title="Share this route"
      description="Choose how you want to share the activity with a friend."
      footer
    />
  ),
}

export const ScrollableBody: Story = {
  render: () => (
    <DialogExample
      title="Import details"
      description="A tall body demonstrates the dialog's bounded scroll area."
      body={Array.from(
        { length: 12 },
        (_, index) => `Imported segment ${index + 1}: 1.2 km cleared.`
      )}
    />
  ),
}

export const DestructiveConfirmation: Story = {
  render: () => <DialogExample destructive footer />,
}

const onConfirm = fn()

export const FocusAndEscape: Story = {
  render: () => <DialogExample onConfirm={onConfirm} />,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Open dialog" })
    await userEvent.click(trigger)
    const dialog = within(document.body).getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(
      within(dialog).getByRole("heading", { name: "Confirm import" })
    ).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => {
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    })
    await expect(trigger).toHaveFocus()
    await expect(onConfirm).not.toHaveBeenCalled()
  },
}

function DialogExample({
  initiallyOpen = false,
  title = "Confirm import",
  description = "The selected activity will be added to this device.",
  footer = false,
  destructive = false,
  body,
  onConfirm,
}: {
  initiallyOpen?: boolean
  title?: string
  description?: string
  footer?: boolean
  destructive?: boolean
  body?: string[]
  onConfirm?: () => void
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {(body ?? ["This action is safe to repeat if needed."]).map(
            (line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            )
          )}
        </div>
        {footer && (
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <DialogClose
              render={
                <Button
                  variant={destructive ? "destructive" : "default"}
                  onClick={onConfirm}
                />
              }
            >
              {destructive ? "Delete all" : "Confirm"}
            </DialogClose>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
