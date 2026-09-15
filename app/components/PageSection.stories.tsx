import type { Meta, StoryObj } from "@storybook/react-vite"

import { PageSection } from "./PageSection"

const meta = {
  title: "Layout/PageSection",
  component: PageSection,
  args: { title: "Section", children: null },
  parameters: { layout: "padded" },
} satisfies Meta<typeof PageSection>

export default meta
type Story = StoryObj<typeof meta>

export const CompactContent: Story = {
  args: {
    title: "Activity details",
    children: <p className="text-sm text-muted-foreground">7.4 km · 42 min</p>,
  },
}

export const LongContent: Story = {
  render: () => (
    <PageSection title="What happens when the route is very long?" id="long">
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Fog of Walk keeps the imported geometry local and reveals the route
          progressively as each valid segment is processed.
        </p>
        <p>
          This longer paragraph demonstrates the section rhythm used by help and
          statistics pages without depending on a route loader.
        </p>
      </div>
    </PageSection>
  ),
}
