import { describe, expect, test } from "bun:test"
import {
  FOG_PROTOCOL_VERSION,
  isFogRequest,
  type FogRequest,
} from "./protocol"

function request(overrides: Partial<FogRequest> = {}): FogRequest {
  return {
    protocolVersion: FOG_PROTOCOL_VERSION,
    requestId: "request-1",
    generation: 3,
    libraryRevision: 7,
    mode: "corridor",
    kind: "rebuild",
    activities: [
      {
        id: "activity-1",
        name: "activity.gpx",
        coordinates: [
          [14, 50],
          [14.01, 50.01],
        ],
      },
    ],
    ...overrides,
  }
}

describe("fog worker protocol validation", () => {
  test("accepts a versioned rebuild and append envelope", () => {
    expect(isFogRequest(request())).toBe(true)
    expect(
      isFogRequest(
        request({
          kind: "append",
          baseLibraryRevision: 6,
        })
      )
    ).toBe(true)
  })

  test("rejects malformed identity, revision, and activity shapes", () => {
    expect(isFogRequest(request({ requestId: "" }))).toBe(false)
    expect(isFogRequest(request({ generation: -1 }))).toBe(false)
    expect(isFogRequest(request({ libraryRevision: Number.NaN }))).toBe(false)
    expect(isFogRequest(request({ kind: "append" }))).toBe(false)
    expect(
      isFogRequest(
        request({
          activities: [
            {
              id: "activity-1",
              name: "activity.gpx",
              coordinates: "not-a-coordinate-array" as never,
            },
          ],
        })
      )
    ).toBe(false)
  })
})
