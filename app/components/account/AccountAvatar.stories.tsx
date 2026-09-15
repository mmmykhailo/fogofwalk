import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent } from "storybook/test"

import { AccountAvatar } from "./AccountAvatar"

const avatarDataUrl =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="

const meta = {
  title: "Account/AccountAvatar",
  component: AccountAvatar,
  args: {
    displayName: "Alex Trail",
    avatarUrl: avatarDataUrl,
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof AccountAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Image: Story = {
  play: async ({ canvas, canvasElement }) => {
    const image = canvasElement.querySelector("img")
    if (!image) throw new Error("Expected the account avatar image")
    await expect(image).toHaveAttribute("alt", "")
    await expect(canvas.queryByText("AT")).not.toBeInTheDocument()
  },
}

export const InitialsFallback: Story = {
  args: { avatarUrl: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("AT")).toBeVisible()
  },
}

export const BrokenImageFallsBack: Story = {
  play: async ({ canvas, canvasElement }) => {
    const image = canvasElement.querySelector("img")
    if (!image) throw new Error("Expected the account avatar image")
    fireEvent.error(image)
    await expect(canvas.getByText("AT")).toBeVisible()
  },
}

export const OneWordName: Story = {
  args: { displayName: "Miyazaki", avatarUrl: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("MI")).toBeVisible()
  },
}

export const UnicodeName: Story = {
  args: { displayName: "Łukasz Żółć", avatarUrl: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("ŁŻ")).toBeVisible()
  },
}

export const AllApplicationSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <AccountAvatar
        displayName="Alex Trail"
        avatarUrl={null}
        className="size-6"
      />
      <AccountAvatar
        displayName="Alex Trail"
        avatarUrl={null}
        className="size-9"
      />
      <AccountAvatar
        displayName="Alex Trail"
        avatarUrl={null}
        className="size-16 text-base"
      />
    </div>
  ),
}
