import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { Textarea } from "./textarea"

const meta = {
  title: "UI/Textarea",
  component: Textarea,
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  render: () => (
    <div className="w-full max-w-md">
      <label htmlFor="point-description">Description</label>
      <Textarea id="point-description" placeholder="Add a note" />
    </div>
  ),
}

export const Populated: Story = {
  render: () => (
    <Textarea
      aria-label="Route notes"
      defaultValue="The trail is shaded until the final climb."
    />
  ),
}

export const Disabled: Story = {
  render: () => (
    <Textarea aria-label="Imported notes" defaultValue="Read only" disabled />
  ),
}

export const Invalid: Story = {
  render: () => (
    <div className="w-full max-w-md">
      <label htmlFor="invalid-description">Description</label>
      <Textarea
        id="invalid-description"
        aria-invalid="true"
        aria-describedby="description-error"
      />
      <p id="description-error" className="mt-1 text-xs text-destructive">
        Description is too long.
      </p>
    </div>
  ),
}

export const CharacterLimit: Story = {
  render: () => <LimitedTextarea />,
  play: async ({ canvas }) => {
    const textarea = canvas.getByRole("textbox", { name: "Saved point note" })
    await userEvent.type(textarea, "A short trail note")
    await expect(textarea).toHaveValue("A short trail note")
    await expect(canvas.getByText("18 / 80")).toBeVisible()
  },
}

export const LongText: Story = {
  render: () => (
    <Textarea
      aria-label="Long route description"
      defaultValue={
        "This long description demonstrates wrapping across several lines. It includes enough detail to make the compact layout meaningful without relying on a live activity or mutable storage."
      }
      rows={6}
    />
  ),
}

function LimitedTextarea() {
  const [value, setValue] = useState("")
  const onChange = fn()
  return (
    <div className="w-full max-w-md">
      <label htmlFor="limited-note">Saved point note</label>
      <Textarea
        id="limited-note"
        maxLength={80}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          onChange(event)
        }}
      />
      <p className="mt-1 text-xs text-muted-foreground">{value.length} / 80</p>
    </div>
  )
}
