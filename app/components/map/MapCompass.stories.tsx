import { useRef, useState } from "react"
import type maplibregl from "maplibre-gl"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"

import { MapCompass } from "./MapCompass"

const meta = {
  title: "Map controls/MapCompass",
  component: MapCompass,
  args: {
    map: null,
    onZoomIn: () => {},
    onZoomOut: () => {},
    onReset: () => {},
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MapCompass>

export default meta
type Story = StoryObj<typeof meta>

export const NoMapAttached: Story = {
  args: { map: null },
}

export const NorthUp: Story = {
  render: () => <CompassWithBearing initialBearing={0} />,
}

export const PositiveAndNegativeBearings: Story = {
  render: () => <BearingHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Bearing 42" }))
    await waitFor(() =>
      expect(canvas.getByTestId("compass-bearing")).toHaveTextContent("42")
    )
    await userEvent.click(canvas.getByRole("button", { name: "Bearing -37" }))
    await waitFor(() =>
      expect(canvas.getByTestId("compass-bearing")).toHaveTextContent("-37")
    )
  },
}

export const WrapsAcross180Degrees: Story = {
  render: () => <CompassWithBearing initialBearing={179} />,
}

export const CompactBackgroundAndControls: Story = {
  render: () => {
    const onZoomIn = fn()
    const onZoomOut = fn()
    const onReset = fn()
    return (
      <div className="w-fit rounded-none bg-slate-700 p-2">
        <MapCompass
          map={null}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onReset={onReset}
        />
      </div>
    )
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Zoom in" }))
    await userEvent.click(canvas.getByRole("button", { name: "Zoom out" }))
    await userEvent.click(canvas.getByRole("button", { name: "Reset to north" }))
  },
}

function CompassWithBearing({ initialBearing }: { initialBearing: number }) {
  const fake = useRef(createFakeMap(initialBearing)).current
  return <MapCompass map={fake.map} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} />
}

function BearingHarness() {
  const [bearing, setBearing] = useState(0)
  const fake = useRef(createFakeMap(0, setBearing)).current
  return (
    <div className="flex items-start gap-4">
      <MapCompass map={fake.map} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} />
      <div className="grid gap-2">
        <button type="button" onClick={() => fake.rotate(42)}>
          Bearing 42
        </button>
        <button type="button" onClick={() => fake.rotate(-37)}>
          Bearing -37
        </button>
        <output data-testid="compass-bearing">{bearing}</output>
      </div>
    </div>
  )
}

function createFakeMap(
  initialBearing: number,
  onBearingChange: (bearing: number) => void = () => {}
) {
  let bearing = initialBearing
  const rotateListeners = new Set<() => void>()
  const map = {
    getBearing: () => bearing,
    on: (event: string, listener: () => void) => {
      if (event === "rotate") rotateListeners.add(listener)
      return map
    },
    off: (event: string, listener: () => void) => {
      if (event === "rotate") rotateListeners.delete(listener)
      return map
    },
  } as unknown as maplibregl.Map

  return {
    map,
    getBearing: () => bearing,
    rotate(nextBearing: number) {
      bearing = nextBearing
      onBearingChange(nextBearing)
      for (const listener of rotateListeners) listener()
    },
  }
}
