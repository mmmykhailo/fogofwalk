import { expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { main } from "../build"
import { fileDigest } from "../src/source-manifest"

test("builds a local PBF manifest and de-duplicates overlapping inputs", async () => {
  const directory = `/tmp/fogofwalk-trail-integration-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const fixture = resolve(
      import.meta.dir,
      "../fixtures/marked-routes.osm.pbf"
    )
    const firstInput = `${directory}/region-a.osm.pbf`
    const secondInput = `${directory}/region-b.osm.pbf`
    const bytes = await Bun.file(fixture).arrayBuffer()
    await Bun.write(firstInput, bytes)
    await Bun.write(secondInput, bytes)

    const sha256 = await fileDigest(firstInput, "sha256")
    const md5 = await fileDigest(firstInput, "md5")
    const input = (path: string) => ({
      path,
      sourceUrl:
        "https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf",
      publishedChecksum: { algorithm: "md5", value: md5 },
      sha256,
    })
    const coverage = {
      kind: "regional" as const,
      bounds: [14.4, 50.04, 14.44, 50.19] as [number, number, number, number],
    }
    const manifest = `${directory}/manifest.json`
    await Bun.write(
      manifest,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          coverage,
          snapshot: "2026-09-07T00:00:00Z",
          inputs: [input(firstInput)],
        },
        null,
        2
      )}\n`
    )

    const archive = `${directory}/trails-build.pmtiles`
    const reportPath = `${directory}/trails-build.report.json`
    await main([
      "build",
      `--manifest=${manifest}`,
      `--output=${archive}`,
      `--report=${reportPath}`,
      `--scratch-dir=${directory}/scratch`,
    ])
    const report = JSON.parse(await readFile(reportPath, "utf8")) as any
    expect(report.builder).toMatchObject({
      name: "fogofwalk-trails",
      language: "typescript",
    })
    expect(report.coverage).toEqual(coverage)
    expect(report.counts).toMatchObject({
      emittedWays: 10,
      emittedFeatures: 15,
      duplicateSourceObjects: 0,
      sourceConflicts: 0,
    })
    expect(report.metrics.passMetrics.map((pass: any) => pass.name)).toEqual([
      "relation-scan",
      "relation-resolution",
      "way-scan",
      "node-scan",
      "geometry-assembly",
      "mvt-packing",
      "independent-verification",
    ])

    const archiveSha256 = await fileDigest(archive, "sha256")

    await main([
      "verify",
      `--archive=${archive}`,
      `--expected=${resolve(import.meta.dir, "../fixtures/expected-z12.json")}`,
      `--checksum=${archiveSha256}`,
    ])

    const overlapManifest = `${directory}/overlap-manifest.json`
    await Bun.write(
      overlapManifest,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          coverage,
          snapshot: "2026-09-07T00:00:00Z",
          inputs: [input(firstInput), input(secondInput)],
        },
        null,
        2
      )}\n`
    )
    const overlapArchive = `${directory}/trails-overlap.pmtiles`
    const overlapReportPath = `${directory}/trails-overlap.report.json`
    await main([
      "build",
      `--manifest=${overlapManifest}`,
      `--output=${overlapArchive}`,
      `--report=${overlapReportPath}`,
      `--scratch-dir=${directory}/overlap-scratch`,
    ])
    const overlapReport = JSON.parse(
      await readFile(overlapReportPath, "utf8")
    ) as any
    expect(overlapReport.counts.duplicateSourceObjects).toBeGreaterThan(0)
    expect(overlapReport.counts.sourceConflicts).toBe(0)
    expect(await fileDigest(overlapArchive, "sha256")).toBe(archiveSha256)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
