import type { Meta, StoryObj } from "@storybook/react-vite"

import { makeSavedPoint } from "../../../.storybook/fixtures/savedPoints"

import { SavedPointsGrid } from "./SavedPointsGrid"

const meta = {
  title: "Saved points/SavedPointsGrid",
  component: SavedPointsGrid,
  args: { points: [makeSavedPoint()] },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SavedPointsGrid>

export default meta
type Story = StoryObj<typeof meta>

export const OnePoint: Story = {
  args: { points: [makeSavedPoint()] },
}

export const ManyPoints: Story = {
  args: {
    points: Array.from({ length: 6 }, (_, index) =>
      makeSavedPoint({
        id: `saved-point-grid-${index + 1}`,
        name: `Grid point ${index + 1}`,
        lng: 14.42 + index / 100,
        lat: 50.07 + index / 100,
        color: ["red", "orange", "amber", "green", "teal", "blue"][
          index
        ] as "red" | "orange" | "amber" | "green" | "teal" | "blue",
        isPublic: index % 2 === 0,
      })
    ),
  },
}
