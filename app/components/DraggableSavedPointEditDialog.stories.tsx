import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { makeSavedPoint } from "../../.storybook/fixtures/savedPoints"

import { DraggableSavedPointEditDialog } from "./DraggableSavedPointEditDialog"

const savedPoint = makeSavedPoint({ id: "saved-point-edit-dialog" })
const successResult = {
  intent: "save-saved-point" as const,
  homeDataReconciled: true as const,
  point: savedPoint,
}

const meta = {
  title: "Saved points/DraggableSavedPointEditDialog",
  component: DraggableSavedPointEditDialog,
  args: {
    point: savedPoint,
    coordinate: null,
    initialId: "saved-point-edit-dialog-create",
    onClose: () => {},
    onSave: () => {},
  },
  parameters: {
    layout: "fullscreen",
    router: { actionResult: successResult },
  },
} satisfies Meta<typeof DraggableSavedPointEditDialog>

export default meta
type Story = StoryObj<typeof meta>

export const DesktopEditExisting: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: { point: savedPoint, coordinate: null, onDelete: fn() },
}

export const PhoneCreateFromCoordinate: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  args: { point: null, coordinate: [14.4211, 50.0784] },
}

export const EditAndSubmit: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <EditDialogHarness />,
  play: async ({ canvas }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "Name" }))
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Name" }),
      "Hilltop marker"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(savedPoint))
    await expect(canvas.getByTestId("saved-point-edit-saved")).toHaveTextContent(
      "1"
    )
  },
}

const onSave = fn()

function EditDialogHarness() {
  const [saved, setSaved] = useState(false)
  return (
    <>
      <DraggableSavedPointEditDialog
        point={savedPoint}
        coordinate={null}
        onClose={() => {}}
        onSave={(point) => {
          onSave(point)
          setSaved(true)
        }}
      />
      <output data-testid="saved-point-edit-saved" className="sr-only">
        {saved ? "1" : "0"}
      </output>
    </>
  )
}

export const CancelPreservesExistingFixture: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <CancelEditHarness />,
  play: async ({ canvas }) => {
    const name = canvas.getByRole("textbox", { name: "Name" })
    await userEvent.clear(name)
    await userEvent.type(name, "Unsaved replacement")
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }))
    await expect(canvas.getByTestId("saved-point-edit-cancelled")).toHaveTextContent(
      "1"
    )
    await expect(name).toHaveValue("Unsaved replacement")
  },
}

function CancelEditHarness() {
  const [cancelled, setCancelled] = useState(false)
  return (
    <>
      <DraggableSavedPointEditDialog
        point={savedPoint}
        coordinate={null}
        onClose={() => setCancelled(true)}
        onSave={() => {}}
      />
      <output data-testid="saved-point-edit-cancelled" className="sr-only">
        {cancelled ? "1" : "0"}
      </output>
    </>
  )
}

export const PendingAndErrorStates: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop" },
    router: {
      actionResult: {
        intent: "save-saved-point",
        errors: { form: "The saved point could not be saved." },
      },
    },
  },
  args: { point: savedPoint, coordinate: null },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }))
    await expect(
      await canvas.findByText("The saved point could not be saved.")
    ).toBeVisible()
  },
}
