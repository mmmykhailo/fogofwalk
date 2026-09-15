import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent } from "storybook/test"

import { EmptySavedPointsState } from "./EmptySavedPointsState"

const meta = {
  title: "Saved points/EmptySavedPointsState",
  component: EmptySavedPointsState,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EmptySavedPointsState>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <EmptyStateHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: /Go to map/ }))
    await expect(
      canvas.getByTestId("empty-saved-points-path")
    ).toHaveTextContent("/map")
  },
}

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  render: () => <EmptyStateHarness />,
}

function EmptyStateHarness() {
  const location = useLocation()
  return (
    <>
      <EmptySavedPointsState />
      <output data-testid="empty-saved-points-path" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
