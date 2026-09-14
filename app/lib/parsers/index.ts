import { parseGpxFile } from "./gpx"
import { parseFitFile } from "./fit"
import { createParserRegistry } from "~/lib/activities/import/registry"
import type { ParsedImportActivity } from "./types"

const parser = createParserRegistry({
  gpx: parseGpxFile,
  fit: parseFitFile,
})

export async function parseFile(file: File): Promise<ParsedImportActivity[]> {
  return parser(file)
}
