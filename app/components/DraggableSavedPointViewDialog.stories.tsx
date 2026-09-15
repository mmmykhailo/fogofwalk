import { useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, fn, userEvent } from "storybook/test"

import { makeSavedPoint } from "../../.storybook/fixtures/savedPoints"

import { Button } from "./ui/button"
import { DraggableSavedPointViewDialog } from "./DraggableSavedPointViewDialog"

const meta = {
  title: "Saved points/DraggableSavedPointViewDialog",
  component: DraggableSavedPointViewDialog,
  args: { point: makeSavedPoint(), onClose: () => {} },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DraggableSavedPointViewDialog>

export default meta
type Story = StoryObj<typeof meta>
type ViewDialogProps = ComponentProps<typeof DraggableSavedPointViewDialog>

export const DesktopWithLongDescription: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    point: makeSavedPoint({
      name: "Lookout above the river",
      description:
        "A long saved-point description wraps inside the draggable card while the coordinates remain easy to scan.",
      isPublic: true,
    }),
  },
  render: (args) => <ViewDialogLauncher {...args} />,
}

export const PhoneWithoutDescription: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  args: { point: makeSavedPoint({ description: null }), onClose: fn() },
  render: (args) => <ViewDialogLauncher {...args} />,
}

const onClose = fn()

export const DesktopCloseAndDrag: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <ViewDialogHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open point" })
    )
    const header = await canvas.findByText("River bend")
    const cardHeader = header.closest("[data-slot='card-header']")
    if (!(cardHeader instanceof HTMLElement))
      throw new Error("Card header missing")
    await fireEvent.pointerDown(cardHeader, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 40,
      clientY: 40,
    })
    await fireEvent.pointerMove(cardHeader, {
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 90,
    })
    await fireEvent.pointerUp(cardHeader, {
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 90,
    })
    await userEvent.click(await canvas.findByRole("button", { name: "Close" }))
    await expect(
      canvas.getByTestId("saved-point-view-closed")
    ).toHaveTextContent("1")
    await expect(onClose).toHaveBeenCalledTimes(1)
  },
}

function ViewDialogLauncher({ point, onClose }: ViewDialogProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {!open && <Button onClick={() => setOpen(true)}>Open point</Button>}
      {open && (
        <DraggableSavedPointViewDialog
          point={point}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )}
      <output data-testid="saved-point-view-closed" className="sr-only">
        {open ? "0" : "1"}
      </output>
    </>
  )
}

function ViewDialogHarness() {
  return <ViewDialogLauncher point={makeSavedPoint()} onClose={onClose} />
}
