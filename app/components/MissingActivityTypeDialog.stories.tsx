import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./ui/button"
import { MissingActivityTypeDialog } from "./MissingActivityTypeDialog"

const meta = {
  title: "Feedback/MissingActivityTypeDialog",
  component: MissingActivityTypeDialog,
  args: { open: false, onOpenChange: () => {}, activityCount: 1 },
} satisfies Meta<typeof MissingActivityTypeDialog>

export default meta
type Story = StoryObj<typeof meta>

export const SingleActivity: Story = {
  render: () => <MissingTypeHarness activityCount={1} />,
}

export const ManyActivities: Story = {
  render: () => <MissingTypeHarness activityCount={5} />,
}

export const CancelRestoresFocus: Story = {
  render: () => <MissingTypeHarness activityCount={2} initiallyOpen={false} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show missing types" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Not now" })
    )
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Show missing types" })
      ).toHaveFocus()
    )
  },
}

export const ContinueToActivityLibrary: Story = {
  render: () => <MissingTypeHarness activityCount={2} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show missing types" })
    )
    await userEvent.click(
      await within(document.body).findByText("Choose types")
    )
    await waitFor(() =>
      expect(canvas.getByTestId("missing-type-path")).toHaveTextContent(
        "/activities"
      )
    )
  },
}

function MissingTypeHarness({
  activityCount,
  initiallyOpen = false,
}: {
  activityCount: number
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previousOpenRef = useRef(open)

  useEffect(() => {
    if (previousOpenRef.current && !open) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    previousOpenRef.current = open
  }, [open])

  const onOpenChange = fn()
  const location = useLocation()
  return (
    <>
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        Show missing types
      </Button>
      <MissingActivityTypeDialog
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen)
          setOpen(nextOpen)
        }}
        activityCount={activityCount}
      />
      <output data-testid="missing-type-path" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
