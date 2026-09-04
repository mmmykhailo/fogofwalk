import { describe, expect, test } from "bun:test"
import { parseActivitySettingsUpdate } from "~/lib/activitySettings"

function formData(entries: [string, string][]): FormData {
  const form = new FormData()
  for (const [key, value] of entries) form.append(key, value)
  return form
}

describe("parseActivitySettingsUpdate", () => {
  test("deduplicates repeated activity ids", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["activityId", "one"],
          ["activityId", "two"],
          ["setting", "publicity"],
          ["value", "true"],
        ])
      )
    ).toEqual({
      ok: true,
      activityIds: ["one", "two"],
      setting: "publicity",
      value: true,
    })
  })

  test("parses supported typed values", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "activityType"],
          ["value", "cycling"],
        ])
      )
    ).toEqual({
      ok: true,
      activityIds: ["one"],
      setting: "activityType",
      value: "cycling",
    })
  })

  test("rejects malformed values", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "publicity"],
          ["value", "yes"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid publicity value." })
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "activityType"],
          ["value", "triathlon"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid activity type." })
  })

  test("requires a target and known setting", () => {
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["setting", "publicity"],
          ["value", "false"],
        ])
      )
    ).toEqual({ ok: false, error: "At least one activity is required." })
    expect(
      parseActivitySettingsUpdate(
        formData([
          ["activityId", "one"],
          ["setting", "unknown"],
          ["value", "false"],
        ])
      )
    ).toEqual({ ok: false, error: "Choose a valid activity setting." })
  })
})
