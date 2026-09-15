import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent } from "storybook/test"

import { EmptyActivitiesState } from "./EmptyActivitiesState"

const meta = {
  title: "Activities/EmptyActivitiesState",
  component: EmptyActivitiesState,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EmptyActivitiesState>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <EmptyStateHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: /Go to map/ }))
    await expect(canvas.getByTestId("empty-state-path")).toHaveTextContent(
      "/map"
    )
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
      <EmptyActivitiesState />
      <output data-testid="empty-state-path" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
