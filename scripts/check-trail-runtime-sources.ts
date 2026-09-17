import { readdir, readFile } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"

const runtimeRoots = ["app", "server/src", "package.json", "bun.lock"]
const extraRoots = process.argv.slice(2).map((argument) => {
  if (!argument.startsWith("--root=")) {
    throw new Error(`unknown argument: ${argument}`)
  }
  const value = argument.slice("--root=".length)
  if (!value) throw new Error("--root must not be blank")
  return value
})
const forbidden = [
  { name: "provider trail host", pattern: /waymarkedtrails\.org/i },
  { name: "public Overpass host", pattern: /overpass-api\.de/i },
  { name: "OSM editing API host", pattern: /api\.openstreetmap\.org/i },
  { name: "OSM raster tile host", pattern: /tile\.openstreetmap\.org/i },
  { name: "browser trail protocol", pattern: /fow-trails:\/\//i },
  {
    name: "trail credential setting",
    pattern: /VITE_TRAIL_(?:ARCHIVE_)?(?:TOKEN|KEY|SECRET)/i,
  },
]

const root = process.cwd()
const files: string[] = []

async function collect(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "build" ||
      entry.name === "coverage"
    ) {
      continue
    }
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) {
      await collect(child)
    } else if (entry.isFile()) {
      files.push(child)
    }
  }
}

for (const configuredRoot of [...runtimeRoots, ...extraRoots]) {
  const path = resolve(root, configuredRoot)
  if (basename(path) === configuredRoot && configuredRoot.includes(".")) {
    files.push(path)
  } else {
    await collect(path)
  }
}

const violations: { file: string; line: number; name: string }[] = []
for (const file of files.sort()) {
  const contents = await readFile(file, "utf8")
  contents.split(/\r?\n/).forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: relative(root, file),
          line: index + 1,
          name: rule.name,
        })
      }
    }
  })
}

if (violations.length > 0) {
  console.error("Forbidden trail runtime source reference(s) found:")
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} (${violation.name})`)
  }
  process.exit(1)
}

console.log(`Trail runtime source guard passed (${files.length} files).`)
