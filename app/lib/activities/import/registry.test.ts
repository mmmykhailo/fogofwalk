import { describe, expect, test } from "bun:test"
import { createParserRegistry, detectActivityFormat } from "./registry"

describe("activity parser registry", () => {
  test("classifies supported extensions case-insensitively", () => {
    expect(detectActivityFormat({ name: "route.GPX", type: "" })).toBe("gpx")
    expect(detectActivityFormat({ name: "ride.FiT", type: "" })).toBe("fit")
  })

  test("uses a supported MIME type when the name has no extension", () => {
    expect(
      detectActivityFormat({ name: "shared-file", type: "application/gpx+xml" })
    ).toBe("gpx")
    expect(
      detectActivityFormat({
        name: "shared-file",
        type: "application/vnd.ant.fit",
      })
    ).toBe("fit")
  })

  test("keeps unsupported formats explicit and does not silently select a parser", async () => {
    const parser = createParserRegistry({
      gpx: async () => [],
    })
    await expect(
      parser(new File(["data"], "notes.txt", { type: "text/plain" }))
    ).rejects.toThrow("Unsupported activity format: .txt")
  })
})
