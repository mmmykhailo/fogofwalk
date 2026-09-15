import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { ErrorCard } from "./ErrorCard"

const meta = {
  title: "Feedback/ErrorCard",
  component: ErrorCard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ErrorCard>

export default meta
type Story = StoryObj<typeof meta>

export const GenericError: Story = {
  args: {
    error: new Error("The activity could not be displayed."),
    reset: fn(),
  },
}

export const RetryAction: Story = {
  args: { error: new Error("Temporary map response failure."), reset: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }))
    await expect(args.reset).toHaveBeenCalledTimes(1)
  },
}

export const LongDetail: Story = {
  args: {
    error: new Error(
      "The activity response exceeded the local display budget while the browser was restoring a large collection of disconnected route segments."
    ),
    reset: fn(),
    className: "flex min-h-96 items-center justify-center bg-background",
  },
}
