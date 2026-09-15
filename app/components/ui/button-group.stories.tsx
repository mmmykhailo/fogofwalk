import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { Button } from "./button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "./button-group"
import { Input } from "./input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

const meta = {
  title: "UI/ButtonGroup",
  component: ButtonGroup,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ButtonGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <ButtonGroup aria-label="Map actions">
      <Button size="sm">Zoom in</Button>
      <Button size="sm" variant="outline">
        Zoom out
      </Button>
      <Button size="sm" variant="ghost">
        Reset
      </Button>
    </ButtonGroup>
  ),
}

export const Vertical: Story = {
  render: () => (
    <ButtonGroup orientation="vertical" aria-label="View actions">
      <Button size="sm">Map</Button>
      <Button size="sm" variant="outline">
        Activities
      </Button>
      <Button size="sm" variant="ghost">
        Saved points
      </Button>
    </ButtonGroup>
  ),
}

export const MixedControls: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ButtonGroup aria-label="Search controls" className="w-full max-w-md">
        <ButtonGroupText>
          <MagnifyingGlassIcon />
          Search
        </ButtonGroupText>
        <Input aria-label="Search activities" placeholder="Name or type" />
        <ButtonGroupSeparator />
        <Select defaultValue="newest">
          <SelectTrigger aria-label="Sort activities" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="distance">Distance</SelectItem>
          </SelectContent>
        </Select>
      </ButtonGroup>
      <ButtonGroup orientation="vertical" aria-label="Vertical separators">
        <ButtonGroupText>Direction</ButtonGroupText>
        <ButtonGroupSeparator orientation="horizontal" />
        <Button variant="outline">North</Button>
        <Button variant="outline">South</Button>
      </ButtonGroup>
    </div>
  ),
}

export const FocusTraversalAndClick: Story = {
  render: () => {
    const onSave = fn()
    return (
      <ButtonGroup aria-label="Editor actions">
        <Button variant="outline">Cancel</Button>
        <Button onClick={onSave}>Save changes</Button>
      </ButtonGroup>
    )
  },
  play: async ({ canvas }) => {
    const group = canvas.getByRole("group", { name: "Editor actions" })
    const save = canvas.getByRole("button", { name: "Save changes" })
    await userEvent.click(save)
    await expect(save).toBeEnabled()
    await userEvent.tab()
    await userEvent.tab()
    await expect(group).toBeVisible()
  },
}
