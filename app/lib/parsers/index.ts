import type { ParsedActivity } from "~/types/activities"
import { backfillContentHashes } from "~/lib/activityHash"
import { parseGpxFile } from "./gpx"
import { parseFitFile } from "./fit"
import { createParserRegistry } from "~/lib/activities/import/registry"

const parser = createParserRegistry({
  gpx: parseGpxFile,
  fit: parseFitFile,
})

export async function parseFile(file: File): Promise<ParsedActivity[]> {
  const activities = await parser(file)

  // Stamped here rather than in each parser: the hash is derived purely from
  // the unified ParsedActivity shape, so it stays format-agnostic and a new
  // parser gets sync dedupe for free.
  await backfillContentHashes(activities)
  return activities
}
