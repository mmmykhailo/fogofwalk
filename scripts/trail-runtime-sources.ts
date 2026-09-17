import { readdir } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

/** Return whether a path is a PMTiles archive inside the public tree. */
export function isPublicPmtilesPath(
  filePath: string,
  publicRoot: string
): boolean {
  const relativePath = relative(resolve(publicRoot), resolve(filePath))
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath) &&
    relativePath.toLowerCase().endsWith(".pmtiles")
  )
}

/** Find public PMTiles archives without reading their binary contents. */
export async function findPublicPmtiles(
  publicRoot: string
): Promise<string[]> {
  const root = resolve(publicRoot)
  const matches: string[] = []

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(child)
      } else if (entry.isFile() && isPublicPmtilesPath(child, root)) {
        matches.push(child)
      }
    }
  }

  await visit(root)
  return matches.sort()
}
