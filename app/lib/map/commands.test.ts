import { describe, expect, test } from "bun:test"
import {
  applyActivitySelectionPaint,
  setLapHighlightData,
} from "~/lib/map/commands"

describe("map rendering commands", () => {
  test("sets the default activity paint when nothing is selected", () => {
    const calls: unknown[][] = []
    const map = {
      setPaintProperty: (...args: unknown[]) => calls.push(args),
    }

    applyActivitySelectionPaint(map as never, [], false)

    expect(calls).toEqual([
      ["activities-layer", "line-width", 2],
      ["activities-layer", "line-opacity", 0.85],
      ["activities-layer", "line-color", "#ff6b35"],
    ])
  })

  test("lap updates safely no-op while the source is unavailable", () => {
    setLapHighlightData({ getSource: () => undefined } as never, [
      [14, 50],
      [15, 51],
    ])
  })

  test("sets an empty collection when clearing a lap", () => {
    let data: unknown
    const map = {
      getSource: () => ({ setData: (next: unknown) => (data = next) }),
    }

    setLapHighlightData(map as never, null)

    expect(data).toEqual({ type: "FeatureCollection", features: [] })
  })
})
