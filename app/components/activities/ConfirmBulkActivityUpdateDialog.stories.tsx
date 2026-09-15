import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { ConfirmBulkActivityUpdateDialog } from "./ConfirmBulkActivityUpdateDialog"

const meta = {
  title: "Activities/ConfirmBulkActivityUpdateDialog",
  component: ConfirmBulkActivityUpdateDialog,
  args: {
    open: false,
    activityCount: 1,
    proposal: { setting: "visibility", value: true },
    isSubmitting: false,
    error: null,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ConfirmBulkActivityUpdateDialog>

export default meta
type Story = StoryObj<typeof meta>

export const MakeOnePublic: Story = {
  args: { activityCount: 1, proposal: { setting: "visibility", value: true } },
}

export const MakeManyPrivate: Story = {
  args: {
    activityCount: 5,
    proposal: { setting: "visibility", value: false },
  },
}

export const ActivityTypeWalking: Story = {
  args: { proposal: { setting: "activityType", value: "walking" } },
}

export const ActivityTypeRunning: Story = {
  args: { proposal: { setting: "activityType", value: "running" } },
}

export const ActivityTypeCycling: Story = {
  args: { proposal: { setting: "activityType", value: "cycling" } },
}

export const ActivityTypeKayaking: Story = {
  args: { proposal: { setting: "activityType", value: "kayaking" } },
}

export const ActivityTypeSwimming: Story = {
  args: { proposal: { setting: "activityType", value: "swimming" } },
}

export const ActivityTypeOther: Story = {
  args: { proposal: { setting: "activityType", value: "other" } },
}

export const Pending: Story = {
  args: {
    activityCount: 3,
    proposal: { setting: "activityType", value: "cycling" },
    isSubmitting: true,
  },
}

export const ServerError: Story = {
  args: {
    activityCount: 2,
    proposal: { setting: "visibility", value: true },
    error: "The selected activities could not be updated. Try again.",
  },
}

const onConfirm = fn()

export const CancelAndConfirmExactOnce: Story = {
  render: () => <BulkDialogHarness onConfirm={onConfirm} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open bulk update" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Cancel" })
    )
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open bulk update" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Confirm" })
    )
    await expect(onConfirm).toHaveBeenCalledTimes(1)
  },
}

function BulkDialogHarness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open bulk update
      </button>
      <ConfirmBulkActivityUpdateDialog
        open={open}
        activityCount={2}
        proposal={{ setting: "visibility", value: true }}
        isSubmitting={false}
        error={null}
        onOpenChange={setOpen}
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
      />
    </>
  )
}
