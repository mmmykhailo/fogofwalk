import { expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"

import { writePublicationArtifacts } from "../src/publication"

async function writeReport(
  directory: string,
  overrides: Record<string, unknown> = {}
): Promise<{ archive: string; report: string }> {
  const archive = `${directory}/trails-2026-09-07-aaaaaaaaaaaa.pmtiles`
  const report = `${directory}/build-report.json`
  const baseCounts = {
    memberWaysSeen: 10,
    emittedWays: 10,
    emittedFeatures: 12,
    tiles: 3,
    overlapCapWays: 0,
  }
  const baseMetrics = { maxCompressedTileBytes: 512 }
  const overrideCounts =
    overrides.counts && typeof overrides.counts === "object"
      ? (overrides.counts as Record<string, unknown>)
      : {}
  const overrideMetrics =
    overrides.metrics && typeof overrides.metrics === "object"
      ? (overrides.metrics as Record<string, unknown>)
      : {}
  const topLevelOverrides = { ...overrides }
  delete topLevelOverrides.counts
  delete topLevelOverrides.metrics

  await Bun.write(archive, "archive")
  await Bun.write(
    report,
    JSON.stringify({
      schemaVersion: 1,
      coverage: { kind: "regional", bounds: [12, 48.5, 19, 51.1] },
      snapshot: "2026-09-07T00:00:00Z",
      inputs: [
        {
          path: "/data/czech-republic-260907.osm.pbf",
          sourceUrl:
            "https://download.geofabrik.de/europe/czech-republic-260907.osm.pbf",
          publishedChecksum: { algorithm: "md5", value: "a".repeat(32) },
          sha256: "b".repeat(64),
        },
      ],
      archive: {},
      builder: { name: "fogofwalk-trails", language: "typescript" },
      ...topLevelOverrides,
      counts: { ...baseCounts, ...overrideCounts },
      metrics: { ...baseMetrics, ...overrideMetrics },
    })
  )
  return { archive, report }
}

test("writes checksum, manifest, licence, and archive metrics", async () => {
  const directory = `/tmp/fogofwalk-publication-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory)
    const artifacts = await writePublicationArtifacts(paths)
    expect(await readFile(artifacts.checksum, "utf8")).toContain(
      artifacts.sha256
    )
    expect(await readFile(artifacts.license, "utf8")).toContain("ODbL-1.0")
    expect(
      JSON.parse(await readFile(artifacts.manifest, "utf8")).archive.sha256
    ).toBe(artifacts.sha256)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects fixture provenance", async () => {
  const directory = `/tmp/fogofwalk-publication-fixture-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory, { snapshot: "fixture" })
    await expect(() => writePublicationArtifacts(paths)).toThrow(
      "fixture trail provenance"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects missing production inputs", async () => {
  const directory = `/tmp/fogofwalk-publication-inputs-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory, { inputs: [] })
    await expect(() => writePublicationArtifacts(paths)).toThrow(
      "source inputs"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects invalid report schema", async () => {
  const directory = `/tmp/fogofwalk-publication-schema-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory, { schemaVersion: 2 })
    await expect(() => writePublicationArtifacts(paths)).toThrow(
      "schemaVersion must be 1"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const [label, counts] of [
  ["emitted ways", { emittedWays: 0 }],
  ["emitted features", { emittedFeatures: 0 }],
  ["tiles", { tiles: 0 }],
] as const) {
  test(`rejects a publication with zero ${label}`, async () => {
    const directory = `/tmp/fogofwalk-publication-zero-${crypto.randomUUID()}`
    await mkdir(directory, { recursive: true })
    try {
      const paths = await writeReport(directory, { counts })
      await expect(() => writePublicationArtifacts(paths)).toThrow(
        "emitted ways, features, and tiles"
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test("rejects a publication with an oversized compressed tile", async () => {
  const directory = `/tmp/fogofwalk-publication-tile-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory, {
      metrics: { maxCompressedTileBytes: 1_048_577 },
    })
    await expect(() => writePublicationArtifacts(paths)).toThrow(
      "1 MiB publication gate"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects a publication that exceeds the overlap-cap gate", async () => {
  const directory = `/tmp/fogofwalk-publication-gate-${crypto.randomUUID()}`
  await mkdir(directory, { recursive: true })
  try {
    const paths = await writeReport(directory, {
      counts: { memberWaysSeen: 10, emittedWays: 10, overlapCapWays: 1 },
    })
    await expect(() => writePublicationArtifacts(paths)).toThrow("0.1%")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
