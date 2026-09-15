import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent, waitFor, within } from "storybook/test"

import { makeServerUser } from "../../.storybook/fixtures/auth"
import { useAuth } from "~/lib/server/authStore"

import { Button } from "./ui/button"
import { ClearAllDialog } from "./ClearAllDialog"

const meta = {
  title: "Feedback/ClearAllDialog",
  component: ClearAllDialog,
  args: {
    open: false,
    onOpenChange: () => {},
    activityCount: 0,
    photoCount: 0,
    onConfirm: () => {},
  },
} satisfies Meta<typeof ClearAllDialog>

export default meta
type Story = StoryObj<typeof meta>

export const ActivitiesOnly: Story = {
  render: () => <ClearAllHarness activityCount={12} photoCount={0} />,
}

export const PhotosOnly: Story = {
  render: () => <ClearAllHarness activityCount={0} photoCount={4} />,
}

export const ActivitiesAndPhotos: Story = {
  render: () => <ClearAllHarness activityCount={12} photoCount={4} />,
}

export const SignedInServerCopy: Story = {
  render: () => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: makeServerUser(),
      canSync: true,
      isAdmin: false,
    })
    return <ClearAllHarness activityCount={12} photoCount={2} />
  },
}

export const ZeroCountDefensiveState: Story = {
  render: () => <ClearAllHarness activityCount={0} photoCount={0} />,
}

export const ConfirmExactlyOnceAndCancel: Story = {
  render: () => <ClearAllHarness activityCount={3} photoCount={1} />,
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
      await within(document.body).findByRole("button", { name: "Clear all" })
    )
    await expect(canvas.getByTestId("clear-confirmations")).toHaveTextContent(
      "1"
    )
  },
}

function ClearAllHarness({
  activityCount,
  photoCount,
}: {
  activityCount: number
  photoCount: number
}) {
  const [open, setOpen] = useState(false)
  const [confirmations, setConfirmations] = useState(0)
  const onConfirm = fn()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open clear dialog</Button>
      <ClearAllDialog
        open={open}
        onOpenChange={setOpen}
        activityCount={activityCount}
        photoCount={photoCount}
        onConfirm={() => {
          onConfirm()
          setConfirmations((count) => count + 1)
        }}
      />
      <output data-testid="clear-confirmations" className="sr-only">
        {confirmations}
      </output>
    </>
  )
}
