import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent, waitFor, within } from "storybook/test"

import { makeServerUser } from "../../.storybook/fixtures/auth"
import { useAuth } from "~/lib/server/authStore"

import { Button } from "./ui/button"
import { ClearActivitiesDialog } from "./ClearActivitiesDialog"

const meta = {
  title: "Feedback/ClearActivitiesDialog",
  component: ClearActivitiesDialog,
  args: {
    open: false,
    onOpenChange: () => {},
    activityCount: 0,
    onConfirm: () => {},
  },
} satisfies Meta<typeof ClearActivitiesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const ActivitiesOnly: Story = {
  render: () => <ClearActivitiesHarness activityCount={12} />,
}

export const SignedInServerCopy: Story = {
  render: () => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: makeServerUser(),
      canSync: true,
      isAdmin: false,
    })
    return <ClearActivitiesHarness activityCount={12} />
  },
}

export const ZeroCountDefensiveState: Story = {
  render: () => <ClearActivitiesHarness activityCount={0} />,
}

export const ConfirmExactlyOnceAndCancel: Story = {
  render: () => <ClearActivitiesHarness activityCount={3} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open clear dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Cancel" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Open clear dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", {
        name: "Clear activities",
      })
    )
    await expect(
      canvas.getByTestId("activity-clear-confirmations")
    ).toHaveTextContent("1")
  },
}

function ClearActivitiesHarness({ activityCount }: { activityCount: number }) {
  const [open, setOpen] = useState(false)
  const [confirmations, setConfirmations] = useState(0)
  const onConfirm = fn()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open clear dialog</Button>
      <ClearActivitiesDialog
        open={open}
        onOpenChange={setOpen}
        activityCount={activityCount}
        onConfirm={() => {
          onConfirm()
          setConfirmations((count) => count + 1)
        }}
      />
      <output data-testid="activity-clear-confirmations" className="sr-only">
        {confirmations}
      </output>
    </>
  )
}
