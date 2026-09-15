import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { VisibilitySelect } from "./VisibilitySelect"

const meta = {
  title: "Activity statistics/VisibilitySelect",
  component: VisibilitySelect,
  args: { isPublic: false, onChange: () => {} },
  parameters: { layout: "padded" },
} satisfies Meta<typeof VisibilitySelect>

export default meta
type Story = StoryObj<typeof meta>

export const Private: Story = {
  args: { isPublic: false, onChange: fn(), ariaLabel: "Activity visibility" },
}

export const Public: Story = {
  args: { isPublic: true, onChange: fn(), ariaLabel: "Activity visibility" },
}

export const Mixed: Story = {
  args: {
    isPublic: false,
    mixed: true,
    onChange: fn(),
    ariaLabel: "Selected activity visibility",
  },
}

export const DisabledWithDescription: Story = {
  args: {
    isPublic: false,
    disabled: true,
    disabledDescription: "Visibility editing requires sync access.",
    onChange: fn(),
    ariaLabel: "Disabled activity visibility",
  },
}

const onChange = fn()

export const KeyboardSelection: Story = {
  render: () => <VisibilityHarness />,
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("combobox", {
      name: "Editable visibility",
    })
    await userEvent.click(trigger)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Public" })
    )
    await expect(onChange).toHaveBeenCalledWith(true)
    await expect(trigger).toHaveTextContent("Public")
  },
}

function VisibilityHarness() {
  const [isPublic, setIsPublic] = useState(false)

  return (
    <VisibilitySelect
      isPublic={isPublic}
      onChange={(value) => {
        onChange(value)
        setIsPublic(value)
      }}
      ariaLabel="Editable visibility"
    />
  )
}
