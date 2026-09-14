import { parseGpxFileWithResults } from "./gpx"
import { parseFitFileWithResults } from "./fit"
import { createParserRegistry } from "~/lib/activities/import/registry"
import type { ParsedImportActivity, ParsedImportParseResult } from "./types"

const parser = createParserRegistry({
  gpx: parseGpxFileWithResults,
  fit: parseFitFileWithResults,
})

export async function parseFileWithResults(
  file: File
): Promise<ParsedImportParseResult> {
  const result = await parser(file)
  return Array.isArray(result) ? { activities: result, rejections: [] } : result
}

export async function parseFile(file: File): Promise<ParsedImportActivity[]> {
  return (await parseFileWithResults(file)).activities
}
