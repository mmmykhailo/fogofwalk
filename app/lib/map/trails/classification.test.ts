import { describe, expect, test } from "bun:test"
import {
  TRAIL_CYCLING_COLOR,
  TRAIL_CYCLING_SORT_ORDER,
  TRAIL_HIKING_COLORS,
  TRAIL_HIKING_FALLBACK_COLOR,
  TRAIL_HIKING_SORT_ORDER,
  TRAIL_PARALLEL_LINE_SEPARATION_PX,
} from "~/constants/trails"
import {
  centeredTrailOffsets,
  classifyTrailFeature,
  extractKctColorTokens,
} from "~/lib/map/trails/classification"

describe("trail classification", () => {
  test("recognizes the current KCT style and color identifiers", () => {
    expect(
      extractKctColorTokens([
        "kct_INT_red-major",
        "kct_nat_green-local",
        "kct_REG_blue-interesting_object",
        "kct_loc_yellow-major",
      ])
    ).toEqual(["red", "green", "blue", "yellow"])
  })

  test("deduplicates and orders supported colors", () => {
    expect(
      extractKctColorTokens([
        "kct_reg_blue-major",
        "kct_reg_red-major",
        "kct_reg_red-local",
        "kct_loc_yellow-major",
        "kct_nat_green-major",
      ])
    ).toEqual(["red", "green", "blue", "yellow"])
  })

  test("uses the neutral fallback for unknown and OSMC-only shields", () => {
    expect(
      extractKctColorTokens([
        "kct_other_red-major",
        "kct_reg_orange-major",
        "red:white:red",
        42,
        null,
      ])
    ).toEqual([])
    expect(classifyTrailFeature("hiking", ["red:white:red"])).toEqual([
      {
        kind: "hiking",
        color: TRAIL_HIKING_FALLBACK_COLOR,
        offset: 0,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
    ])
  })

  test("centers parallel route colors around the source line", () => {
    expect(centeredTrailOffsets(1)).toEqual([0])
    expect(centeredTrailOffsets(2)).toEqual([
      -TRAIL_PARALLEL_LINE_SEPARATION_PX / 2,
      TRAIL_PARALLEL_LINE_SEPARATION_PX / 2,
    ])
    expect(centeredTrailOffsets(4)).toEqual([-4.5, -1.5, 1.5, 4.5])
    expect(centeredTrailOffsets(0)).toEqual([])
  })

  test("emits one scalar properties object per ordered hiking color", () => {
    expect(
      classifyTrailFeature("hiking", [
        "kct_reg_blue-major",
        "kct_reg_red-major",
        "kct_reg_red-local",
        "kct_reg_yellow-major",
        "kct_reg_green-major",
      ])
    ).toEqual([
      {
        kind: "hiking",
        color: TRAIL_HIKING_COLORS.red,
        offset: -4.5,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
      {
        kind: "hiking",
        color: TRAIL_HIKING_COLORS.green,
        offset: -1.5,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
      {
        kind: "hiking",
        color: TRAIL_HIKING_COLORS.blue,
        offset: 1.5,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
      {
        kind: "hiking",
        color: TRAIL_HIKING_COLORS.yellow,
        offset: 4.5,
        sort: TRAIL_HIKING_SORT_ORDER,
      },
    ])
  })

  test("always emits configured cycling properties without reading shields", () => {
    expect(classifyTrailFeature("cycling", ["kct_reg_red-major"])).toEqual([
      {
        kind: "cycling",
        color: TRAIL_CYCLING_COLOR,
        offset: 0,
        sort: TRAIL_CYCLING_SORT_ORDER,
      },
    ])
  })
})
