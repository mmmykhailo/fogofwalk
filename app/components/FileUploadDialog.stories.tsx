import { useEffect, useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  expect,
  fireEvent,
  fn,
  mocked,
  userEvent,
  waitFor,
  within,
} from "storybook/test"

import { useAuth } from "~/lib/server/authStore"

import { Button } from "./ui/button"
import { FileUploadDialog } from "./FileUploadDialog"

const meta = {
  title: "Feedback/FileUploadDialog",
  component: FileUploadDialog,
  args: {
    open: false,
    onOpenChange: () => {},
    onAddFiles: () => {},
    onLoadSampleData: () => {},
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof FileUploadDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Serverless: Story = {
  render: (args) => <UploadHarness {...args} />,
}

export const SignedOutWithSignInOption: Story = {
  render: (args) => {
    mocked(useAuth).mockReturnValue({ status: "signedOut" })
    return <UploadHarness {...args} />
  },
}

export const SignedInWithoutSignInOption: Story = {
  render: (args) => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: {
        id: "fixture-user",
        displayName: "Alex Trail",
        avatarUrl: null,
        handle: "alex-trail",
        provider: "github",
        status: "allowed",
      },
      canSync: true,
      isAdmin: false,
    })
    return <UploadHarness {...args} />
  },
}

export const FileSelection: Story = {
  args: { onAddFiles: fn(), onLoadSampleData: fn() },
  render: (args) => <UploadHarness {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open upload dialog" })
    )
    const input = await within(document.body).findByLabelText("Activity files")
    const transfer = new DataTransfer()
    transfer.items.add(
      new File(["<gpx />"], "morning-walk.gpx", {
        type: "application/gpx+xml",
      })
    )
    await fireEvent.change(input, { target: { files: transfer.files } })
    await expect(args.onAddFiles).toHaveBeenCalledTimes(1)
    await expect(input).toHaveAttribute("accept", ".gpx,.fit")
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: "Load activity files" })
      ).not.toBeInTheDocument()
    )
  },
}

export const SampleImport: Story = {
  args: { onAddFiles: fn(), onLoadSampleData: fn() },
  render: (args) => <UploadHarness {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open upload dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Try sample" })
    )
    await expect(args.onLoadSampleData).toHaveBeenCalledTimes(1)
  },
}

export const FocusCloseFlow: Story = {
  render: (args) => <UploadHarness initiallyOpen={false} {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open upload dialog" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Skip for now" })
    )
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: "Load activity files" })
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Open upload dialog" })
      ).toHaveFocus()
    )
  },
}

function UploadHarness(
  props: Partial<React.ComponentProps<typeof FileUploadDialog>> & {
    initiallyOpen?: boolean
  }
) {
  const [open, setOpen] = useState(props.initiallyOpen ?? false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previousOpenRef = useRef(open)

  useEffect(() => {
    if (previousOpenRef.current && !open) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    previousOpenRef.current = open
  }, [open])

  return (
    <div className="flex min-h-80 items-center justify-center">
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        Open upload dialog
      </Button>
      <FileUploadDialog
        open={open}
        onOpenChange={setOpen}
        onAddFiles={props.onAddFiles ?? (() => {})}
        onLoadSampleData={props.onLoadSampleData ?? (() => {})}
      />
    </div>
  )
}
