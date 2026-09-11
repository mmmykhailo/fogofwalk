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
    <type>Walking</type>
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

/** One activity with two deliberately distant track segments. */
export function makeDisconnectedGpx(): GpxFixture {
  const segments = [
    [
      [0, 0],
      [0.01, 0.01],
    ],
    [
      [1, 1],
      [1.01, 1.01],
    ],
  ] as const
  const trkSegments = segments
    .map(
      (segment) => `
    <trkseg>
${segment
  .map(
    ([lng, lat], index) =>
      `      <trkpt lat="${lat}" lon="${lng}"><ele>${index}</ele></trkpt>`
  )
  .join("\n")}
    </trkseg>`
    )
    .join("")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>disconnected visual fixture</name>
    <type>Walking</type>${trkSegments}
  </trk>
</gpx>
`
  return {
    name: "disconnected-visual.gpx",
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}

/** A dense, closed multi-segment route for real-browser fog rendering checks. */
export function makeFogVisualGpx(): GpxFixture {
  const rectangle: [number, number][] = []
  const west = 13.45
  const east = 13.55
  const south = 52.45
  const north = 52.55
  const sidePoints = 48
  for (let index = 0; index < sidePoints; index += 1) {
    const fraction = index / (sidePoints - 1)
    rectangle.push([west + (east - west) * fraction, south])
  }
  for (let index = 1; index < sidePoints; index += 1) {
    const fraction = index / (sidePoints - 1)
    rectangle.push([east, south + (north - south) * fraction])
  }
  for (let index = 1; index < sidePoints; index += 1) {
    const fraction = index / (sidePoints - 1)
    rectangle.push([east - (east - west) * fraction, north])
  }
  for (let index = 1; index < sidePoints; index += 1) {
    const fraction = index / (sidePoints - 1)
    rectangle.push([west, north - (north - south) * fraction])
  }
  rectangle.push(rectangle[0]!)

  const diagonal = Array.from(
    { length: 96 },
    (_, index) =>
      [
        west + ((east - west) * index) / 95,
        south + ((north - south) * index) / 95,
      ] as [number, number]
  )
  const segments = [rectangle, diagonal]
  const trkSegments = segments
    .map(
      (segment) => `
    <trkseg>
${segment
  .map(
    ([lng, lat], index) =>
      `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${100 + index}</ele></trkpt>`
  )
  .join("\n")}
    </trkseg>`
    )
    .join("")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>dense fog visual fixture</name>
    <type>Walking</type>${trkSegments}
  </trk>
</gpx>
`
  return {
    name: "dense-fog-visual.gpx",
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}
