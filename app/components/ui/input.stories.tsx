import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { Input } from "./input"

const meta = {
  title: "UI/Input",
  component: Input,
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {
  render: () => (
    <div className="w-full max-w-sm">
      <label htmlFor="activity-name">Activity name</label>
      <Input id="activity-name" placeholder="Morning loop" />
    </div>
  ),
}

export const File: Story = {
  render: () => (
    <div className="w-full max-w-sm">
      <label htmlFor="activity-file">Activity file</label>
      <Input id="activity-file" type="file" accept=".gpx,.fit" />
    </div>
  ),
}

export const Number: Story = {
  render: () => (
    <div className="w-full max-w-sm">
      <label htmlFor="distance">Distance (km)</label>
      <Input
        id="distance"
        type="number"
        min={0}
        step="0.1"
        defaultValue="7.4"
      />
    </div>
  ),
}

export const PopulatedDisabled: Story = {
  render: () => (
    <Input aria-label="Profile handle" value="fogwalker" disabled readOnly />
  ),
}

export const InvalidWithDescription: Story = {
  render: () => (
    <div className="w-full max-w-sm">
      <label htmlFor="required-name">Name</label>
      <Input
        id="required-name"
        aria-invalid="true"
        aria-describedby="name-error"
        placeholder="A name is required"
      />
      <p id="name-error" className="mt-1 text-xs text-destructive">
        Enter a name before saving this point.
      </p>
    </div>
  ),
}

export const ControlledTyping: Story = {
  render: () => {
    const onChange = fn()
    return <ControlledInput onChange={onChange} />
  },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "Activity name" })
    await userEvent.clear(input)
    await userEvent.type(input, "Riverside walk")
    await expect(input).toHaveValue("Riverside walk")
  },
}

function ControlledInput({
  onChange,
}: {
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [value, setValue] = useState("")
  return (
    <div className="w-full max-w-sm">
      <label htmlFor="controlled-activity-name">Activity name</label>
      <Input
        id="controlled-activity-name"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          onChange(event)
        }}
      />
    </div>
  )
}
