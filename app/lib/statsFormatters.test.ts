import { expect, test } from "bun:test"
import { formatPace } from "~/lib/statsFormatters"

test("formats non-finite paces as unavailable", () => {
  expect(formatPace(Infinity)).toBe("—")
  expect(formatPace(NaN)).toBe("—")
})
