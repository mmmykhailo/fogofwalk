import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import type { ImportFailureSummary } from "~/lib/activities/import/service"

import { Button } from "./ui/button"
import { ParseErrorDialog } from "./ParseErrorDialog"

const meta = {
  title: "Feedback/ParseErrorDialog",
  component: ParseErrorDialog,
  args: {
    open: false,
    onOpenChange: () => {},
    failedFiles: [],
  },
} satisfies Meta<typeof ParseErrorDialog>

export default meta
type Story = StoryObj<typeof meta>

export const OneFailure: Story = {
  render: () => <ParseErrorHarness failedFiles={["damaged-route.gpx"]} />,
}

export const MixedFailures: Story = {
  render: () => (
    <ParseErrorHarness
      failedFiles={["broken.gpx", "unsupported.fit"]}
      failureDetails={[
        { name: "broken.gpx", status: "failed", error: "Malformed XML." },
        {
          name: "unsupported.fit",
          status: "rejected",
          error: "No readable activity records.",
        },
      ]}
    />
  ),
}

export const LongFileNameAndMessage: Story = {
  render: () => (
    <ParseErrorHarness
      failedFiles={[
        "2026-09-15-very-long-exported-route-name-from-a-wearable-device.gpx",
      ]}
      failureDetails={[
        {
          name: "2026-09-15-very-long-exported-route-name-from-a-wearable-device.gpx",
          status: "failed",
          error:
            "The file was truncated while being downloaded and did not contain a complete track segment.",
        },
      ]}
      canRetry
    />
  ),
}

export const RetryAndDiscard: Story = {
  render: () => <ParseErrorHarness failedFiles={["shared.gpx"]} canRetry />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show import errors" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Try again" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

function ParseErrorHarness({
  failedFiles,
  failureDetails,
  canRetry = false,
}: {
  failedFiles: string[]
  failureDetails?: ImportFailureSummary[]
  canRetry?: boolean
}) {
  const [open, setOpen] = useState(false)
  const onRetry = fn()
  const onDiscard = fn()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show import errors</Button>
      <ParseErrorDialog
        open={open}
        onOpenChange={setOpen}
        failedFiles={failedFiles}
        failureDetails={failureDetails}
        canRetry={canRetry}
        onRetry={() => {
          onRetry()
          setOpen(false)
        }}
        onDiscard={() => {
          onDiscard()
          setOpen(false)
        }}
      />
    </>
  )
}
