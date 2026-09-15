import { useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"

import { makePhoto, makePhotoGroup } from "../../.storybook/fixtures/photos"

import { Button } from "./ui/button"
import { DraggablePhotoDialog } from "./DraggablePhotoDialog"

const photoUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'%3E%3Crect width='640' height='480' fill='%230f766e'/%3E%3C/svg%3E"

const meta = {
  title: "Photos/DraggablePhotoDialog",
  component: DraggablePhotoDialog,
  args: {
    group: makePhotoGroup({
      photos: [makePhoto({ objectUrl: photoUrl })],
    }),
    onClose: () => {},
    ensurePhotoObjectUrl: () => photoUrl,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DraggablePhotoDialog>

export default meta
type Story = StoryObj<typeof meta>
type PhotoDialogProps = ComponentProps<typeof DraggablePhotoDialog>

export const DesktopLandscape: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: (args) => <PhotoDialogHarness {...args} />,
}

export const PhonePortrait: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  args: {
    group: makePhotoGroup({
      photos: [
        makePhoto({
          file: new File(["portrait"], "portrait-long-filename.jpg", {
            type: "image/jpeg",
          }),
          objectUrl: photoUrl,
        }),
      ],
    }),
  },
  render: (args) => <PhotoDialogHarness {...args} />,
}

export const MultiplePhotosAndBoundaries: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <PhotoNavigationHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open photo" })
    )
    await expect(canvas.getByText("1 / 3")).toBeVisible()
    const previous = canvas.getByRole("button", { name: "Previous photo" })
    await expect(previous).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "Next photo" }))
    await expect(canvas.getByText("2 / 3")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Next photo" }))
    await expect(canvas.getByText("3 / 3")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Next photo" })
    ).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  },
}

const onClose = fn()

function PhotoNavigationHarness() {
  const [open, setOpen] = useState(false)
  const photos = [
    makePhoto({ id: "photo-one", objectUrl: photoUrl }),
    makePhoto({
      id: "photo-two",
      objectUrl: photoUrl,
      takenAtMs: makePhoto().takenAtMs + 1_000,
    }),
    makePhoto({
      id: "photo-three",
      objectUrl: photoUrl,
      takenAtMs: makePhoto().takenAtMs + 2_000,
    }),
  ]
  return (
    <>
      {!open && <Button onClick={() => setOpen(true)}>Open photo</Button>}
      {open && (
        <DraggablePhotoDialog
          group={makePhotoGroup({ id: "photo-navigation", photos })}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          ensurePhotoObjectUrl={() => photoUrl}
        />
      )}
    </>
  )
}

function PhotoDialogHarness({
  group,
  onClose,
  ensurePhotoObjectUrl,
}: PhotoDialogProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {!open && <Button onClick={() => setOpen(true)}>Open photo</Button>}
      {open && (
        <DraggablePhotoDialog
          group={group}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          ensurePhotoObjectUrl={ensurePhotoObjectUrl}
        />
      )}
    </>
  )
}
