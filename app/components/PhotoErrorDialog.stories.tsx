import { useState } from "react"
import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./ui/button"
import { PhotoErrorDialog } from "./PhotoErrorDialog"

const meta = {
  title: "Feedback/PhotoErrorDialog",
  component: PhotoErrorDialog,
  args: { open: false, onOpenChange: () => {} },
} satisfies Meta<typeof PhotoErrorDialog>

export default meta
type Story = StoryObj<typeof meta>

export const SinglePhotoFailure: Story = {
  render: () => <PhotoErrorHarness />,
}

export const MultiplePhotoFailures: Story = {
  render: () => <PhotoErrorHarness />,
}

export const HelpLinkAndClose: Story = {
  render: () => <PhotoErrorHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await within(document.body).findByRole("link", { name: "help page" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("photo-error-path")).toHaveTextContent("/help")
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Close" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

function PhotoErrorHarness() {
  const [open, setOpen] = useState(true)
  const location = useLocation()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show photo errors</Button>
      <PhotoErrorDialog open={open} onOpenChange={setOpen} />
      <output data-testid="photo-error-path" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
