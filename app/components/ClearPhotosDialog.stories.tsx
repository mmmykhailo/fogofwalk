import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./ui/button"
import { ClearPhotosDialog } from "./ClearPhotosDialog"

const meta = {
  title: "Feedback/ClearPhotosDialog",
  component: ClearPhotosDialog,
  args: {
    open: false,
    onOpenChange: () => {},
    photoCount: 0,
    onConfirm: () => {},
  },
} satisfies Meta<typeof ClearPhotosDialog>

export default meta
type Story = StoryObj<typeof meta>

export const PhotosOnly: Story = {
  render: () => <ClearPhotosHarness photoCount={4} />,
}

export const PhotoPermanenceCopy: Story = {
  render: () => <ClearPhotosHarness photoCount={1} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open clear dialog" })
    )
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Clear photos?",
    })
    await expect(dialog).toHaveTextContent("local-only")
    await expect(dialog).toHaveTextContent("cannot be recovered")
    await expect(dialog).not.toHaveTextContent("server")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" })
    )
  },
}

export const ConfirmExactlyOnceAndCancel: Story = {
  render: () => <ClearPhotosHarness photoCount={2} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open clear dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Cancel" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Open clear dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", {
        name: "Clear photos",
      })
    )
    await expect(
      canvas.getByTestId("photo-clear-confirmations")
    ).toHaveTextContent("1")
  },
}

function ClearPhotosHarness({ photoCount }: { photoCount: number }) {
  const [open, setOpen] = useState(false)
  const [confirmations, setConfirmations] = useState(0)
  const onConfirm = fn()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open clear dialog</Button>
      <ClearPhotosDialog
        open={open}
        onOpenChange={setOpen}
        photoCount={photoCount}
        onConfirm={() => {
          onConfirm()
          setConfirmations((count) => count + 1)
        }}
      />
      <output data-testid="photo-clear-confirmations" className="sr-only">
        {confirmations}
      </output>
    </>
  )
}
