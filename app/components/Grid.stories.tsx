import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import { Grid } from "./Grid"

const meta = {
  title: "Layout/Grid",
  component: Grid,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Grid>

export default meta
type Story = StoryObj<typeof meta>

const labels = ["Import", "Explore", "Review", "Share", "Archive", "Sync"]

export const ResponsiveColumns: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  render: () => (
    <Grid columns={{ base: 1, sm: 2, md: 3, lg: 4 }}>
      {labels.slice(0, 4).map((label) => (
        <GridCell key={label} label={label} />
      ))}
    </Grid>
  ),
}

export const OneThroughFourColumns: Story = {
  render: () => (
    <div className="space-y-4">
      {[1, 2, 3, 4].map((count) => (
        <Grid key={count} columns={{ base: count as 1 | 2 | 3 | 4 }}>
          {labels.slice(0, count).map((label) => (
            <GridCell key={label} label={`${count} · ${label}`} />
          ))}
        </Grid>
      ))}
    </div>
  ),
}

export const MixedColumnSpans: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => (
    <Grid columns={{ base: 1, md: 4 }}>
      <GridCell label="Wide summary" className="md:col-span-2" />
      <GridCell label="Recent activity" />
      <GridCell label="Saved point" />
      <GridCell label="Chart" className="md:col-span-3" />
      <GridCell label="Status" />
    </Grid>
  ),
  play: async ({ canvas }) => {
    const cells = await canvas.findAllByTestId("grid-cell")
    await expect(cells.map((cell) => cell.textContent)).toEqual([
      "Wide summary",
      "Recent activity",
      "Saved point",
      "Chart",
      "Status",
    ])
  },
}

function GridCell({ label, className }: { label: string; className?: string }) {
  return (
    <div
      data-testid="grid-cell"
      className={`border border-border bg-muted/40 p-4 text-xs ${className ?? ""}`}
    >
      {label}
    </div>
  )
}
