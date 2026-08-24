import type { ParsedActivity } from "~/types/activities"
import { backfillContentHashes } from "~/lib/activityHash"
import { parseGpxFile } from "./gpx"
import { parseFitFile } from "./fit"

export async function parseFile(file: File): Promise<ParsedActivity[]> {
  const ext = file.name.split(".").pop()?.toLowerCase()
  let activities: ParsedActivity[]
  if (ext === "gpx") activities = await parseGpxFile(file)
  else if (ext === "fit") activities = await parseFitFile(file)
  else throw new Error(`Unsupported format: .${ext}`)

  // Stamped here rather than in each parser: the hash is derived purely from
  // the unified ParsedActivity shape, so it stays format-agnostic and a new
  // parser gets sync dedupe for free.
  await backfillContentHashes(activities)
  return activities
}
