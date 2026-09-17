import { describe, expect, test } from "bun:test"

import {
  CYCLING_COLOR,
  HIKING_FALLBACK_COLOR,
  classifyRelation,
  networkRank,
  selectVisualFeatures,
  type TrailMembership,
} from "../src/classifier"

describe("trail classifier", () => {
  test("accepts only schema-one relation kinds", () => {
    expect(classifyRelation(1, { type: "route", route: "hiking" })?.kind).toBe(
      "hiking"
    )
    expect(
      classifyRelation(2, { type: "superroute", route: "foot" })?.kind
    ).toBe("hiking")
    expect(classifyRelation(3, { type: "route", route: "bicycle" })?.kind).toBe(
      "cycling"
    )
    expect(classifyRelation(4, { type: "route", route: "walking" })).toBeNull()
    expect(classifyRelation(5, { type: "route", route: "mtb" })).toBeNull()
    expect(
      classifyRelation(6, { type: "collection", route: "hiking" })
    ).toBeNull()
  })

  test("normalizes rank and color precedence", () => {
    const tags: Record<string, string> = {
      type: "route",
      route: "hiking",
      network: "iwn",
      "osmc:symbol": " RED:white:red_bar ",
      colour: "green",
    }
    expect(classifyRelation(10, tags)).toMatchObject({
      networkRank: 4,
      color: "#d9272e",
      unsupportedColor: false,
    })

    delete tags["osmc:symbol"]
    expect(classifyRelation(10, tags)?.color).toBe("#15803d")
    tags.colour = "white"
    expect(classifyRelation(10, tags)).toMatchObject({
      color: HIKING_FALLBACK_COLOR,
      unsupportedColor: true,
    })
  })

  test("uses fixed cycling color and separate rank range", () => {
    const result = classifyRelation(11, {
      type: "route",
      route: "bicycle",
      network: "ncn",
      colour: "red",
    })
    expect(result).toMatchObject({ networkRank: 3, color: CYCLING_COLOR })
    expect(
      selectVisualFeatures([
        {
          relationId: 11,
          kind: "cycling",
          networkRank: 3,
          color: CYCLING_COLOR,
          inherited: false,
        },
      ]).features[0]?.sort
    ).toBe(23)
  })

  test("covers every supported network rank", () => {
    expect(networkRank("hiking", "iwn")).toBe(4)
    expect(networkRank("hiking", "nwn")).toBe(3)
    expect(networkRank("hiking", "rwn")).toBe(2)
    expect(networkRank("hiking", "lwn")).toBe(1)
    expect(networkRank("cycling", "icn")).toBe(4)
    expect(networkRank("cycling", "ncn")).toBe(3)
    expect(networkRank("cycling", "rcn")).toBe(2)
    expect(networkRank("cycling", "lcn")).toBe(1)
    expect(networkRank("cycling", "unknown")).toBe(0)
  })

  test("deduplicates shared keys and centers four lanes", () => {
    const memberships: TrailMembership[] = []
    const colors = ["#d9272e", "#15803d", "#1769aa", "#eab308", "#ea580c"]
    for (let index = 0; index < colors.length; index++) {
      memberships.push({
        relationId: 100 + index,
        kind: "hiking",
        networkRank: index === 0 ? 4 : 1,
        color: colors[index],
        inherited: false,
      })
    }
    memberships.push({
      relationId: 999,
      kind: "hiking",
      networkRank: 4,
      color: colors[0],
      inherited: true,
    })
    memberships.push({
      relationId: 300,
      kind: "cycling",
      networkRank: 2,
      color: CYCLING_COLOR,
      inherited: false,
    })
    memberships.push({
      relationId: 301,
      kind: "cycling",
      networkRank: 4,
      color: CYCLING_COLOR,
      inherited: true,
    })

    const selected = selectVisualFeatures(memberships)
    expect(selected.features).toHaveLength(5)
    expect(selected.droppedKeys).toBe(1)
    expect(
      selected.features.slice(0, 4).map((feature) => feature.offset)
    ).toEqual([-4.5, -1.5, 1.5, 4.5])
    expect(selected.features.at(-1)).toMatchObject({
      relationId: 301,
      sort: 24,
    })
  })
})
