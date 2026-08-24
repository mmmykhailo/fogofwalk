/**
 * Small GPX fixtures.
 *
 * Deliberately not `public/sample-run.gpx` — that is 12 MB with 82,364 points,
 * and buffering it through the fog worker takes seconds per import. These are a
 * few dozen points, which exercises the identical code path in milliseconds.
 */

export interface GpxFixture {
  name: string
  buffer: Buffer
  mimeType: string
}

/**
 * An activity whose geometry is derived from `seed`, so two fixtures with different
 * seeds get different content hashes and the same seed always reproduces the
 * same hash — which is what the dedupe assertions rely on.
 */
export function makeGpx(name: string, seed: number, points = 20): GpxFixture {
  const startMs = Date.UTC(2024, 0, 1 + seed, 8, 0, 0)
  const lng0 = 13.4 + seed * 0.05
  const lat0 = 52.5 + seed * 0.05

  const trkpts = Array.from({ length: points }, (_, i) => {
    const lng = (lng0 + i * 0.0005).toFixed(6)
    const lat = (lat0 + i * 0.0004).toFixed(6)
    const time = new Date(startMs + i * 10_000).toISOString()
    return `      <trkpt lat="${lat}" lon="${lng}"><ele>${100 + i}</ele><time>${time}</time></trkpt>`
  }).join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
  return {
    name,
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}

/** `count` distinct activities, named `t1.gpx`…, each with its own geometry. */
export function makeGpxSet(count: number, seedOffset = 0): GpxFixture[] {
  return Array.from({ length: count }, (_, i) =>
    makeGpx(`t${i + 1}.gpx`, seedOffset + i + 1)
  )
}
