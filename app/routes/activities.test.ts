import { describe, expect, test } from "bun:test"
import { mapStore } from "~/lib/mapStore"
import { clientAction, shouldRevalidate } from "~/routes/activities"
import type { ParsedActivity } from "~/types/activities"

function activity(
  id: string,
  overrides: Partial<ParsedActivity> = {}
): ParsedActivity {
  return {
    id,
    name: `${id}.gpx`,
    startedAtMs: null,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    format: "gpx",
    stats: {
      distanceKm: 1,
      uniqueDistanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationProfile: [],
    },
    ...overrides,
  }
}

async function runAction(entries: [string, string][]) {
  const formData = new FormData()
  for (const [key, value] of entries) formData.append(key, value)
  return clientAction({
    request: new Request("http://localhost/activities", {
      method: "POST",
      body: formData,
    }),
  } as never)
}

describe("activities settings action", () => {
  test("updates one activity's type through the normalized contract", async () => {
    const first = activity("one", {
      activityType: "walking",
      isPublic: true,
    })
    mapStore.activities = [first]

    const result = await runAction([
      ["intent", "update-activity-settings"],
      ["activityId", "one"],
      ["setting", "activityType"],
      ["value", "cycling"],
    ])

    expect(result).toEqual({
      ok: true,
      updatedActivityIds: ["one"],
      setting: "activityType",
      value: "cycling",
    })
    expect(first.activityType).toBe("cycling")
    expect(first.isPublic).toBe(true)
  })

  test("updates every deduplicated target while preserving publicity", async () => {
    const first = activity("one", {
      activityType: "walking",
      isPublic: true,
    })
    const second = activity("two", {
      activityType: "running",
      isPublic: false,
    })
    mapStore.activities = [first, second]

    const result = await runAction([
      ["intent", "update-activity-settings"],
      ["activityId", "one"],
      ["activityId", "one"],
      ["activityId", "two"],
      ["setting", "activityType"],
      ["value", "cycling"],
    ])

    expect(result).toMatchObject({
      ok: true,
      updatedActivityIds: ["one", "two"],
    })
    expect(first.activityType).toBe("cycling")
    expect(second.activityType).toBe("cycling")
    expect(first.isPublic).toBe(true)
    expect(second.isPublic).toBe(false)
  })

  test("rejects a missing target atomically", async () => {
    const first = activity("one", { activityType: "walking" })
    const second = activity("two", { activityType: "running" })
    mapStore.activities = [first, second]

    const result = await runAction([
      ["intent", "update-activity-settings"],
      ["activityId", "one"],
      ["activityId", "missing"],
      ["setting", "activityType"],
      ["value", "cycling"],
    ])

    expect(result).toEqual({
      ok: false,
      error: "One or more activities no longer exist.",
    })
    expect(first.activityType).toBe("walking")
    expect(second.activityType).toBe("running")
  })

  test("rejects publicity changes when sync is unavailable", async () => {
    const first = activity("one", { contentHash: "hash-one", isPublic: false })
    const second = activity("two", { contentHash: "hash-two", isPublic: true })
    mapStore.activities = [first, second]

    const result = await runAction([
      ["intent", "update-activity-settings"],
      ["activityId", "one"],
      ["activityId", "two"],
      ["setting", "publicity"],
      ["value", "true"],
    ])

    expect(result).toEqual({
      ok: false,
      error: "Publicity can only be changed for synced activities.",
    })
    expect(first.isPublic).toBe(false)
    expect(second.isPublic).toBe(true)
  })
})

describe("activities route revalidation", () => {
  const revalidate = (current: string, next: string, extra = {}) =>
    shouldRevalidate({
      currentUrl: new URL(`http://localhost${current}`),
      currentParams: {},
      nextUrl: new URL(`http://localhost${next}`),
      nextParams: {},
      defaultShouldRevalidate: true,
      ...extra,
    })

  test("skips loader work for supported sort-only navigation", () => {
    expect(revalidate("/activities", "/activities?sort=distance")).toBe(false)
    expect(
      revalidate("/activities?sort=distance", "/activities?sort=speed")
    ).toBe(false)
  })

  test("keeps default revalidation for actions and unrelated changes", () => {
    expect(
      revalidate("/activities?sort=date", "/activities?sort=distance", {
        formMethod: "POST",
      })
    ).toBe(true)
    expect(revalidate("/activities", "/activities?filter=walking")).toBe(true)
    expect(revalidate("/map", "/activities?sort=distance")).toBe(true)
    expect(
      shouldRevalidate({
        currentUrl: new URL("http://localhost/activities"),
        currentParams: {},
        nextUrl: new URL("http://localhost/activities?sort=distance"),
        nextParams: {},
        defaultShouldRevalidate: false,
      })
    ).toBe(false)
  })
})
