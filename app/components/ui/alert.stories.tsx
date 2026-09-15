import { InfoIcon, WarningIcon } from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert"
import { Button } from "./button"

const meta = {
  title: "UI/Alert",
  component: Alert,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Alert>
      <InfoIcon />
      <AlertTitle>Import ready</AlertTitle>
      <AlertDescription>
        Your activity is ready to add to the local library.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <WarningIcon />
      <AlertTitle>Import could not be completed</AlertTitle>
      <AlertDescription>
        The file contains no usable coordinates. Choose another GPX or FIT file
        and try again.
      </AlertDescription>
    </Alert>
  ),
}

export const WithActionAndLongCopy: Story = {
  render: () => (
    <Alert>
      <InfoIcon />
      <AlertTitle>Sync is paused</AlertTitle>
      <AlertDescription>
        The local library is safe, but new changes will remain on this device
        until the server is reachable again. You can keep importing files and
        exploring the map while the connection recovers.
      </AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          Retry
        </Button>
      </AlertAction>
    </Alert>
  ),
}
