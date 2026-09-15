import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import { ChangelogContents } from "./ChangelogContents"

const meta = {
  title: "Feedback/ChangelogContents",
  component: ChangelogContents,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ChangelogContents>

export default meta
type Story = StoryObj<typeof meta>

const validChangelog = `## [0.8.0] - 2026-09-15

### Added
- Public profile statistics
- Keyboard-accessible saved points

### Fixed
- Restored fog state after a style reload

## [0.7.0] - 2026-08-28

### Changed
- Faster local activity imports
`

export const MultipleReleases: Story = {
  args: { changelog: validChangelog },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Version 0.8.0" })
    ).toBeVisible()
    await expect(
      await canvas.findByRole("heading", { name: "Version 0.7.0" })
    ).toBeVisible()
    await expect(
      await canvas.findByText("Public profile statistics")
    ).toBeVisible()
  },
}

export const EmptyContent: Story = {
  args: { changelog: "" },
}

export const UnexpectedLines: Story = {
  args: {
    changelog: `Intro text

### Ignored before a release
- Still ignored

## [0.6.0] - 2026-07-01

Unexpected paragraph

### Notes
- Parsed bullet
`,
  },
}
