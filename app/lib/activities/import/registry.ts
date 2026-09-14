import type { ParsedImportActivity } from "~/lib/parsers/types"

export type ActivityParser = (file: File) => Promise<ParsedImportActivity[]>

export type ActivityFileFormat = "gpx" | "fit"

export function detectActivityFormat(
  file: Pick<File, "name" | "type">
): ActivityFileFormat | null {
  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension === "gpx" || extension === "fit") return extension
  if (file.type === "application/gpx+xml" || file.type === "application/gpx") {
    return "gpx"
  }
  if (
    file.type === "application/vnd.ant.fit" ||
    file.type === "application/fit"
  ) {
    return "fit"
  }
  return null
}

export function createParserRegistry(
  parsers: Partial<Record<ActivityFileFormat, ActivityParser>>
): ActivityParser {
  return async (file) => {
    const format = detectActivityFormat(file)
    if (!format) {
      const extension = file.name.includes(".")
        ? `.${file.name.split(".").pop()}`
        : ""
      throw new Error(`Unsupported activity format: ${extension || "unknown"}`)
    }
    const parser = parsers[format]
    if (!parser) throw new Error(`No parser registered for ${format} files.`)
    return parser(file)
  }
}
