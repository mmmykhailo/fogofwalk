import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"

import { Pagination } from "./Pagination"

const meta = {
  title: "Navigation/Pagination",
  component: Pagination,
  args: {
    itemCount: 3,
    pageSize: 10,
    itemLabel: "activity",
    currentPage: 1,
    totalPages: 1,
    onPageChange: () => {},
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof Pagination>

export default meta
type Story = StoryObj<typeof meta>

export const OnePage: Story = {
  args: {
    itemCount: 3,
    pageSize: 10,
    itemLabel: "activity",
    currentPage: 1,
    totalPages: 1,
    onPageChange: () => {},
  },
}

export const FirstPage: Story = {
  render: () => <PaginationDemo initialPage={1} />,
}

export const MiddlePageWithEllipses: Story = {
  render: () => <PaginationDemo initialPage={6} />,
}

export const LastPage: Story = {
  render: () => <PaginationDemo initialPage={10} />,
}

export const ControlledNavigation: Story = {
  render: () => <PaginationDemo initialPage={1} />,
  play: async ({ canvas }) => {
    const next = await canvas.findByRole("button", { name: "Next page" })
    await expect(
      await canvas.findByRole("button", { name: "Previous page" })
    ).toBeDisabled()
    await userEvent.click(next)
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Page 2" })).toHaveAttribute(
        "aria-current",
        "page"
      )
    )
    await userEvent.click(
      await canvas.findByRole("button", { name: "Previous page" })
    )
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Page 1" })).toHaveAttribute(
        "aria-current",
        "page"
      )
    )
  },
}

function PaginationDemo({ initialPage }: { initialPage: number }) {
  const [currentPage, setCurrentPage] = useState(initialPage)
  return (
    <Pagination
      itemCount={97}
      pageSize={10}
      itemLabel="activity"
      currentPage={currentPage}
      totalPages={10}
      onPageChange={setCurrentPage}
    />
  )
}
