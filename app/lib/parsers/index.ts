import type { ParsedTrack } from "~/types/tracks"
import { backfillContentHashes } from "~/lib/trackHash"
import { parseGpxFile } from "./gpx"
import { parseFitFile } from "./fit"

export async function parseFile(file: File): Promise<ParsedTrack[]> {
  const ext = file.name.split(".").pop()?.toLowerCase()
  let tracks: ParsedTrack[]
  if (ext === "gpx") tracks = await parseGpxFile(file)
  else if (ext === "fit") tracks = await parseFitFile(file)
  else throw new Error(`Unsupported format: .${ext}`)

  // Stamped here rather than in each parser: the hash is derived purely from
  // the unified ParsedTrack shape, so it stays format-agnostic and a new
  // parser gets sync dedupe for free.
  await backfillContentHashes(tracks)
  return tracks
}
