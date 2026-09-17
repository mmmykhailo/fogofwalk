import { expect, test } from "bun:test"
import { mkdir, readFile } from "node:fs/promises"

import { writePublicationArtifacts } from "../src/publication"

test("writes checksum, manifest, licence, and archive metrics", async () => {
  const directory = `/tmp/fogofwalk-publication-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  const archive = `${directory}/trails-2026-09-07-aaaaaaaaaaaa.pmtiles`
  const report = `${directory}/build-report.json`
  await Bun.write(archive, "archive")
  await Bun.write(
    report,
    JSON.stringify({
      schemaVersion: 1,
      snapshot: "2026-09-07T00:00:00Z",
      counts: { memberWaysSeen: 10, emittedWays: 10, overlapCapWays: 0 },
      archive: {},
      inputs: [],
      builder: { name: "fogofwalk-trails", language: "typescript" },
    })
  )
  const artifacts = await writePublicationArtifacts({ archive, report })
  expect(await readFile(artifacts.checksum, "utf8")).toContain(artifacts.sha256)
  expect(await readFile(artifacts.license, "utf8")).toContain("ODbL-1.0")
  expect(
    JSON.parse(await readFile(artifacts.manifest, "utf8")).archive.sha256
  ).toBe(artifacts.sha256)
})
