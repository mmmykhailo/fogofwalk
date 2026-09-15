import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import { ActivitiesPagination } from "./ActivitiesPagination"

const meta = {
  title: "Activities/ActivitiesPagination",
  component: ActivitiesPagination,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivitiesPagination>

export default meta
type Story = StoryObj<typeof meta>

export const FirstOfMany: Story = {
  args: { activityCount: 37, currentPage: 1, totalPages: 4, onPageChange: fn() },
}

export const LastPage: Story = {
  args: { activityCount: 37, currentPage: 4, totalPages: 4, onPageChange: fn() },
}

const onPageChange = fn()

export const NextPageReportsExactNumber: Story = {
  args: {
    activityCount: 37,
    currentPage: 2,
    totalPages: 4,
    onPageChange,
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Next page" }))
    await expect(onPageChange).toHaveBeenCalledWith(3)
  },
}
