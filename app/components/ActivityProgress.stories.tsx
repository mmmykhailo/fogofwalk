import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import type { ActivityProgressRow } from "~/lib/activities/progress"

import { ActivityProgressPanel } from "./ActivityProgress"

const meta = {
  title: "Feedback/ActivityProgressPanel",
  component: ActivityProgressPanel,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivityProgressPanel>

export default meta
type Story = StoryObj<typeof meta>

export const ParsingOnly: Story = {
  args: { rows: [row("parsing", 2, 4)] },
}

export const ParsingAndWaitingToSave: Story = {
  args: {
    rows: [row("parsing", 4, 4), row("saved", 1, 4)],
  },
}

export const AllThreeStages: Story = {
  args: {
    rows: [row("parsing", 4, 4), row("saved", 2, 4), row("fog", 3, 8)],
  },
}

export const AppendFogRequest: Story = {
  args: { rows: [row("fog", 2, 3)] },
}

export const TerminalIncompleteRow: Story = {
  args: { rows: [row("fog", 1, 3)] },
}

export const CompleteRows: Story = {
  args: {
    rows: [row("parsing", 4, 4), row("saved", 4, 4), row("fog", 8, 8)],
  },
  play: async ({ canvas }) => {
    const bars = canvas.getAllByRole("progressbar")
    await expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual([
      "Parsing activities",
      "Activities saved",
      "Processing fog",
    ])
    await expect(bars[2]).toHaveAttribute("aria-valuenow", "8")
    await expect(bars[2]).toHaveAttribute("aria-valuemax", "8")
    await expect(bars[2]).toHaveAttribute("aria-valuetext", "8 of 8 activities")
  },
}

function row(
  stage: ActivityProgressRow["stage"],
  current: number,
  maximum: number
): ActivityProgressRow {
  const labels = {
    parsing: "Parsing activities",
    saved: "Activities saved",
    fog: "Processing fog",
  } as const
  const units = { parsing: "files", saved: "files", fog: "activities" } as const
  return {
    stage,
    label: labels[stage],
    current,
    maximum,
    unit: units[stage],
    percentage: maximum > 0 ? Math.round((current / maximum) * 100) : 0,
  }
}
