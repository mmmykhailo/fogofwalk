import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select"

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

const activityOptions = [
  { value: "walking", label: "Walking" },
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
] as const

export const Placeholder: Story = {
  render: () => <ActivitySelect aria-label="Activity type" />,
}

export const Selected: Story = {
  render: () => (
    <ActivitySelect aria-label="Activity type" initialValue="running" />
  ),
}

export const Disabled: Story = {
  render: () => (
    <Select disabled defaultValue="walking">
      <SelectTrigger aria-label="Activity type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {activityOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
}

export const GroupedWithSeparator: Story = {
  render: () => (
    <Select defaultValue="walking">
      <SelectTrigger aria-label="Preferred activity">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>On foot</SelectLabel>
          <SelectItem value="walking">Walking</SelectItem>
          <SelectItem value="running">Running</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>On wheels</SelectLabel>
          <SelectItem value="cycling">Cycling</SelectItem>
          <SelectItem value="skating">Skating</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const LongScrollableList: Story = {
  render: () => (
    <ActivitySelect
      aria-label="Activity type"
      contentClassName="max-h-48"
      options={Array.from({ length: 16 }, (_, index) => ({
        value: `activity-${index}`,
        label: `Imported activity ${String(index + 1).padStart(2, "0")}`,
      }))}
    />
  ),
}

const onValueChange = fn()

export const KeyboardSelection: Story = {
  render: () => (
    <ActivitySelect aria-label="Activity type" onValueChange={onValueChange} />
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("combobox", { name: "Activity type" })
    await userEvent.click(trigger)
    await userEvent.keyboard("{ArrowDown}{Enter}")
    await expect(trigger).toHaveTextContent(/walking/i)
    await userEvent.click(trigger)
    await userEvent.keyboard("{Escape}")
    await expect(trigger).toHaveFocus()
    await expect(onValueChange).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("listbox")
      ).not.toBeInTheDocument()
    )
  },
}

function ActivitySelect({
  initialValue = null,
  onValueChange,
  options = activityOptions,
  contentClassName,
  ...triggerProps
}: {
  initialValue?: string | null
  onValueChange?: (value: string | null) => void
  options?: readonly { value: string; label: string }[]
  contentClassName?: string
  "aria-label": string
}) {
  const [value, setValue] = useState<string | null>(initialValue)
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue)
        onValueChange?.(nextValue)
      }}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder="Choose an activity" />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
