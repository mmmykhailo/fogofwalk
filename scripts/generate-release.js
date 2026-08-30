#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = join(rootDir, "package.json")
const serverPackageJsonPath = join(rootDir, "server", "package.json")
const changelogPath = join(rootDir, "CHANGELOG.md")
const bumpType = process.argv[2] ?? "patch"

if (!new Set(["major", "minor", "patch"]).has(bumpType)) {
  throw new Error("Usage: bun run release [major|minor|patch]")
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const serverPackageJson = JSON.parse(
  readFileSync(serverPackageJsonPath, "utf8")
)
if (packageJson.version !== serverPackageJson.version) {
  throw new Error(
    `Client and server versions must match (${packageJson.version} !== ${serverPackageJson.version})`
  )
}
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version)
if (!versionMatch) {
  throw new Error(`package.json version must be semver: ${packageJson.version}`)
}

const [major, minor, patch] = versionMatch.slice(1).map(Number)
const nextVersion =
  bumpType === "major"
    ? `${major + 1}.0.0`
    : bumpType === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

const changelog = readFileSync(changelogPath, "utf8")

let releaseCommit
try {
  // Tags are created after deployment and can lag behind a committed release.
  // The release commit is the authoritative changelog boundary in that case.
  releaseCommit = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--grep", "^release v[0-9]"],
    {
      cwd: rootDir,
      encoding: "utf8",
    }
  ).trim()
} catch {
  releaseCommit = undefined
}

let lastTag
if (!releaseCommit) {
  try {
    lastTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: rootDir,
      encoding: "utf8",
    }).trim()
  } catch {
    lastTag = undefined
  }
}

let commitRange = releaseCommit
  ? `${releaseCommit}..HEAD`
  : lastTag
    ? `${lastTag}..HEAD`
    : "HEAD"
if (!releaseCommit && !lastTag) {
  // A release made before Actions has pushed the first version tag still
  // needs notes only for changes since the existing changelog baseline.
  try {
    const changelogCommit = execFileSync(
      "git",
      ["log", "-1", "--format=%H", "--", "CHANGELOG.md"],
      { cwd: rootDir, encoding: "utf8" }
    ).trim()
    if (changelogCommit) commitRange = `${changelogCommit}..HEAD`
  } catch {
    // No changelog history: include the complete project history.
  }
}

const commits = execFileSync("git", ["log", commitRange, "--format=%s"], {
  cwd: rootDir,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((commit) => commit && !/^release v\d+\.\d+\.\d+$/.test(commit))

const today = new Date().toISOString().slice(0, 10)
const changes = commits.length
  ? commits.map((commit) => `- ${commit}`).join("\n")
  : "- Initial release"
const entry = `## [${nextVersion}] - ${today}\n\n### Changed\n\n${changes}\n\n`
const firstRelease = changelog.search(/^## \[/m)
const updatedChangelog =
  firstRelease === -1
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, firstRelease)}${entry}${changelog.slice(firstRelease)}`

packageJson.version = nextVersion
serverPackageJson.version = nextVersion
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
writeFileSync(
  serverPackageJsonPath,
  `${JSON.stringify(serverPackageJson, null, 2)}\n`
)
writeFileSync(changelogPath, updatedChangelog)

console.log(`Prepared v${nextVersion} from ${commits.length} commits.`)
