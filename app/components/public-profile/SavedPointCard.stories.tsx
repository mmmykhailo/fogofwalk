import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"
import { useLocation } from "react-router"

import {
  makeSavedPoint,
  makeSavedPointsByColor,
} from "../../../.storybook/fixtures/savedPoints"

import { SavedPointCard } from "./SavedPointCard"

const meta = {
  title: "Saved points/SavedPointCard",
  component: SavedPointCard,
  args: { point: makeSavedPoint() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SavedPointCard>

export default meta
type Story = StoryObj<typeof meta>

export const EveryColour: Story = {
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Object.values(makeSavedPointsByColor()).map((point) => (
        <SavedPointCard key={point.id} point={point} />
      ))}
    </div>
  ),
}

export const PublicPoint: Story = {
  args: { point: makeSavedPoint({ isPublic: true }) },
}

export const NoDescription: Story = {
  args: { point: makeSavedPoint({ description: null }) },
}

export const LongNameAndDescription: Story = {
  args: {
    point: makeSavedPoint({
      name: "A very long saved point name that remains readable in a narrow card",
      description:
        "A long description demonstrates wrapping without changing the map link or pushing the coordinate label out of the card.",
    }),
  },
}

export const BoundaryCoordinates: Story = {
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2">
      <SavedPointCard
        point={makeSavedPoint({
          id: "saved-point-west",
          name: "Western edge",
          lng: -180,
          lat: -90,
          color: "purple",
        })}
      />
      <SavedPointCard
        point={makeSavedPoint({
          id: "saved-point-east",
          name: "Eastern edge",
          lng: 180,
          lat: 90,
          color: "pink",
          isPublic: true,
        })}
      />
    </div>
  ),
}

const locationTestId = "saved-point-card-location"

export const MapLinkIsKeyboardAccessible: Story = {
  render: () => <CardLinkHarness />,
  play: async ({ canvas }) => {
    const link = await canvas.findByRole("link", {
      name: "Open River bend on the map",
    })
    link.focus()
    await expect(link).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(canvas.getByTestId(locationTestId)).toHaveTextContent(
        "/map?savedPoint=saved-point-fixture-1"
      )
    )
  },
}

function CardLinkHarness() {
  const location = useLocation()
  return (
    <>
      <SavedPointCard point={makeSavedPoint()} />
      <output data-testid={locationTestId} className="sr-only">
        {location.pathname + location.search}
      </output>
    </>
  )
}
