import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { makeSavedPoint } from "../../.storybook/fixtures/savedPoints"
import type { StoryRouterActionArgs } from "../../.storybook/decorators/RouterDecorator"

import { SavedPointForm } from "./SavedPointForm"

const savedPoint = makeSavedPoint({ id: "saved-point-edit" })
const savedPointResult = {
  intent: "save-saved-point" as const,
  homeDataReconciled: true as const,
  point: savedPoint,
}

const meta = {
  title: "Saved points/SavedPointForm",
  component: SavedPointForm,
  args: {
    point: null,
    coordinate: [14.4211, 50.0784] as [number, number],
    onCancel: () => {},
    onSave: () => {},
  },
  parameters: {
    layout: "padded",
    router: { actionResult: savedPointResult },
  },
} satisfies Meta<typeof SavedPointForm>

export default meta
type Story = StoryObj<typeof meta>

export const CreateFromCoordinates: Story = {
  args: { point: null, coordinate: [14.4211, 50.0784] },
}

export const EditExisting: Story = {
  args: {
    point: savedPoint,
    coordinate: null,
    onDelete: fn(),
  },
}

const submitted = fn()

export const PaletteVisibilityAndTrimmedSubmit: Story = {
  parameters: {
    router: {
      actionResult: savedPointResult,
      actionSpy: ({ request }: StoryRouterActionArgs) => {
        void request.formData().then((formData) => {
          submitted({
            id: formData.get("id"),
            lng: formData.get("lng"),
            lat: formData.get("lat"),
            name: formData.get("name"),
            description: formData.get("description"),
            color: formData.get("color"),
            isPublic: formData.get("isPublic"),
          })
        })
      },
    },
  },
  render: () => (
    <SavedPointForm
      point={null}
      coordinate={[14.4211, 50.0784]}
      initialId="saved-point-create"
      onCancel={() => {}}
      onSave={() => {}}
    />
  ),
  play: async ({ canvas }) => {
    submitted.mockClear()
    await userEvent.type(canvas.getByRole("textbox", { name: "Name" }), "  Summit  ")
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Description" }),
      "  A high view.  "
    )
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Saved point colour" })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Pink" })
    )
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Saved point visibility" })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Public" })
    )
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    await waitFor(() =>
      expect(submitted).toHaveBeenCalledWith({
        id: expect.any(String),
        lng: "14.421100",
        lat: "50.078400",
        name: "  Summit  ",
        description: "  A high view.  ",
        color: "pink",
        isPublic: "true",
      })
    )
  },
}

export const RouteValidationFailure: Story = {
  parameters: {
    router: {
      actionResult: {
        intent: "save-saved-point",
        errors: { name: "Enter a name." },
      },
    },
  },
  args: { point: null, coordinate: [14.4211, 50.0784] },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Name" }), "Bad")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    await expect(
      await canvas.findByText("Enter a name.")
    ).toBeVisible()
  },
}

export const MaximumLengthCopy: Story = {
  args: {
    point: makeSavedPoint({
      name: "A name at the maximum supported length",
      description: "A description that can be expanded up to the documented limit.",
    }),
    coordinate: null,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "maxlength",
      "120"
    )
    await expect(
      canvas.getByRole("textbox", { name: "Description" })
    ).toHaveAttribute("maxlength", "2000")
  },
}
