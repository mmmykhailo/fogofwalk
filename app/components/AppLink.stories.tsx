import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor } from "storybook/test"
import { useLocation } from "react-router"

import { AppLink } from "./AppLink"
import { TransitionLink } from "./TransitionLink"

const meta = {
  title: "Navigation/AppLink and TransitionLink",
  component: AppLink,
  args: { to: "/map", children: "Open map" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof AppLink>

export default meta
type Story = StoryObj<typeof meta>

export const SubtleAndNavigationLinks: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <AppLink to="/activities">View all activities</AppLink>
      <AppLink to="/map" variant="nav">
        Back to map
      </AppLink>
    </div>
  ),
}

export const InternalNavigation: Story = {
  render: () => (
    <LinkHarness>
      <TransitionLink to="/stats">Open statistics</TransitionLink>
    </LinkHarness>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: "Open statistics" }))
    await waitFor(() =>
      expect(canvas.getByTestId("link-path")).toHaveTextContent("/stats")
    )
  },
}

export const OptionsAndModifiedClicks: Story = {
  render: () => <LinkHarness showOptions />,
  play: async ({ canvas }) => {
    const target = canvas.getByRole("link", { name: "Open in another tab" })
    const reload = canvas.getByRole("link", { name: "Reload document" })
    const modified = canvas.getByRole("link", { name: "Modified route" })

    await expect(target).toHaveAttribute("target", "_blank")
    await expect(reload).toHaveAttribute("href", "/help")
    await fireEvent.click(target)
    await fireEvent.click(reload)
    await fireEvent.click(modified, { button: 0, ctrlKey: true })
    await expect(canvas.getByTestId("link-path")).toHaveTextContent("/")
    await expect(canvas.getByTestId("modified-click")).toHaveTextContent("1")
  },
}

function LinkHarness({
  children,
  showOptions = false,
}: {
  children?: React.ReactNode
  showOptions?: boolean
}) {
  const location = useLocation()
  const [modifiedClicks, setModifiedClicks] = useState(0)
  const preventNative = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {children}
      {showOptions && (
        <>
          <TransitionLink to="/profile" target="_blank" onClick={preventNative}>
            Open in another tab
          </TransitionLink>
          <TransitionLink to="/help" reloadDocument onClick={preventNative}>
            Reload document
          </TransitionLink>
          <TransitionLink
            to="/activities"
            onClick={(event) => {
              if (event.ctrlKey) {
                event.preventDefault()
                setModifiedClicks((count) => count + 1)
              }
            }}
          >
            Modified route
          </TransitionLink>
        </>
      )}
      <output data-testid="link-path">{location.pathname}</output>
      <output data-testid="modified-click">{modifiedClicks}</output>
    </div>
  )
}
