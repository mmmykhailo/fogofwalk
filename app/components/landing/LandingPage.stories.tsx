import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"

import { LandingPage } from "./LandingPage"

const meta = {
  title: "Landing/LandingPage",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingPage>

export default meta
type Story = StoryObj<typeof meta>

export const DesktopLight: Story = {}

export const PhoneLight: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
}

export const DesktopDark: Story = {
  globals: { theme: "dark" },
}

export const PrimaryCallToActionAndPolicyLinks: Story = {
  render: () => <LandingNavigationHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: "Start exploring" }))
    await waitFor(() =>
      expect(canvas.getByTestId("landing-location")).toHaveTextContent("/map")
    )

    await new Promise((resolve) => setTimeout(resolve, 350))
    await userEvent.click(canvas.getByRole("link", { name: "Fog of Walk" }))
    await waitFor(() =>
      expect(canvas.getByTestId("landing-location")).toHaveTextContent("/")
    )

    await new Promise((resolve) => setTimeout(resolve, 350))
    await userEvent.click(
      canvas.getByRole("link", { name: "Supports GPX and FIT" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("landing-location")).toHaveTextContent("/help")
    )

    await new Promise((resolve) => setTimeout(resolve, 350))
    await userEvent.click(canvas.getByRole("link", { name: "Privacy Policy" }))
    await waitFor(() =>
      expect(canvas.getByTestId("landing-location")).toHaveTextContent(
        "/privacy"
      )
    )
  },
}

function LandingNavigationHarness() {
  const location = useLocation()
  return (
    <>
      <LandingPage />
      <output data-testid="landing-location" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
