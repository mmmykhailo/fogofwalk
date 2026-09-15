import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import { ElevationChart } from "./ElevationChart"

const meta = {
  title: "Activity statistics/ElevationChart",
  component: ElevationChart,
  args: { profile: [] },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ElevationChart>

export default meta
type Story = StoryObj<typeof meta>

const shortProfile = [
  { distanceKm: 0, elevationM: 242 },
  { distanceKm: 2.4, elevationM: 278 },
  { distanceKm: 4.8, elevationM: 259 },
  { distanceKm: 7.4, elevationM: 301 },
]

export const ShortProfile: Story = {
  args: { profile: shortProfile },
}

export const LongProfile: Story = {
  render: () => (
    <div className="w-full max-w-2xl">
      <ElevationChart
        profile={Array.from({ length: 25 }, (_, index) => ({
          distanceKm: index * 0.75,
          elevationM: 220 + Math.round(Math.sin(index / 2) * 40 + index * 2),
        }))}
      />
    </div>
  ),
}

export const FlatElevation: Story = {
  render: () => (
    <ElevationChart
      profile={[
        { distanceKm: 0, elevationM: 160 },
        { distanceKm: 3, elevationM: 160 },
        { distanceKm: 6, elevationM: 160 },
      ]}
    />
  ),
}

export const NarrowContainer: Story = {
  render: () => (
    <div className="w-56">
      <ElevationChart profile={shortProfile} />
    </div>
  ),
}

export const TooShortToRender: Story = {
  args: { profile: [{ distanceKm: 0, elevationM: 160 }] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
  },
}
