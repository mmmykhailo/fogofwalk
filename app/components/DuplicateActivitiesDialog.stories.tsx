import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./ui/button"
import { DuplicateActivitiesDialog } from "./DuplicateActivitiesDialog"

const meta = {
  title: "Feedback/DuplicateActivitiesDialog",
  component: DuplicateActivitiesDialog,
  args: { open: false, onOpenChange: () => {}, duplicateCount: 1 },
} satisfies Meta<typeof DuplicateActivitiesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const OneDuplicate: Story = {
  render: () => <DuplicateHarness duplicateCount={1} />,
}

export const ManyDuplicates: Story = {
  render: () => <DuplicateHarness duplicateCount={8} />,
}

export const AcknowledgeAndClose: Story = {
  render: () => <DuplicateHarness duplicateCount={2} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Close" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

function DuplicateHarness({ duplicateCount }: { duplicateCount: number }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show duplicates</Button>
      <DuplicateActivitiesDialog
        open={open}
        onOpenChange={setOpen}
        duplicateCount={duplicateCount}
      />
    </>
  )
}
