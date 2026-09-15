import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"

import { PageShell } from "./PageShell"

const meta = {
  title: "Layout/PageShell",
  component: PageShell,
  args: { children: null },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PageShell>

export default meta
type Story = StoryObj<typeof meta>

export const TitleAndBackLink: Story = {
  render: () => (
    <PageShell
      title="My activities"
      backTo="/activities"
      backLabel="Back to activities"
    >
      <LocationReadout />
      <p className="text-sm text-muted-foreground">Your imported routes.</p>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("link", { name: "Back to activities" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("current-path")).toHaveTextContent(
        "/activities"
      )
    )
  },
}

export const SeveralSections: Story = {
  render: () => (
    <PageShell title="Help">
      <PageSectionPreview title="Importing files" />
      <PageSectionPreview title="Clearing the map" />
      <PageSectionPreview title="Sharing a profile" />
    </PageShell>
  ),
}

function LocationReadout() {
  const location = useLocation()
  return (
    <output data-testid="current-path" className="sr-only">
      {location.pathname}
    </output>
  )
}

function PageSectionPreview({ title }: { title: string }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">
        A focused section with a short explanation.
      </p>
    </section>
  )
}
