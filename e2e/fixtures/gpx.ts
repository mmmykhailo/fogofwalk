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

/** One high-confidence mid-track spike that should become two retained paths. */
export function makeGpsAnomalyGpx(): GpxFixture {
  const coordinates: [number, number][] = [
    [13.4, 52.5],
    [13.4001, 52.5],
    [13.4002, 52.5],
    [13.4003, 52.5],
    [13.4004, 52.5],
    [23.4, 52.5],
    [13.4005, 52.5],
    [13.4006, 52.5],
    [13.4007, 52.5],
    [13.4008, 52.5],
  ]
  const startMs = Date.UTC(2024, 0, 20, 8, 0, 0)
  const trkpts = coordinates
    .map(
      ([lng, lat], index) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>100</ele><time>${new Date(startMs + index * 1_000).toISOString()}</time></trkpt>`
    )
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>GPS anomaly cleanup fixture</name>
    <type>Walking</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
  return {
    name: "gps-anomaly-e2e.gpx",
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}

/** A local track with a 45-second recording pause that must remain disconnected. */
export function makeGpsRecordingGapGpx(): GpxFixture {
  const startMs = Date.UTC(2024, 0, 21, 8, 0, 0)
  const coordinates: [number, number][] = [
    [13.41, 52.5],
    [13.4101, 52.5],
    [13.4102, 52.5],
    [13.4103, 52.5],
    [13.4104, 52.5],
    [13.4105, 52.5],
    [13.4106, 52.5],
    [13.4107, 52.5],
  ]
  const trkpts = coordinates
    .map(([lng, lat], index) => {
      const timestamp =
        index < 6
          ? startMs + index * 1_000
          : startMs + 50_000 + (index - 6) * 1_000
      return `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><time>${new Date(timestamp).toISOString()}</time></trkpt>`
    })
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>GPS recording gap fixture</name>
    <type>Walking</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
  return {
    name: "gps-recording-gap-e2e.gpx",
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}

function gpsFixturePoint(
  lng: number,
  lat: number,
  timestamp: number,
  options: { accuracyM?: number; speedMps?: number } = {}
): string {
  const extension =
    options.accuracyM == null && options.speedMps == null
      ? ""
      : `<extensions><gpxtpx:TrackPointExtension>` +
        `${options.speedMps == null ? "" : `<gpxtpx:speed>${options.speedMps}</gpxtpx:speed>`}` +
        `${options.accuracyM == null ? "" : `<gpxtpx:hAcc>${options.accuracyM}</gpxtpx:hAcc>`}` +
        `</gpxtpx:TrackPointExtension></extensions>`
  return (
    `      <trkpt lat="${lat.toFixed(8)}" lon="${lng.toFixed(8)}">` +
    `<time>${new Date(timestamp).toISOString()}</time>${extension}</trkpt>`
  )
}

function gpsLongitudeForMeters(
  originLng: number,
  latitude: number,
  xM: number
) {
  return originLng + xM / (111_195 * Math.cos((latitude * Math.PI) / 180))
}

/** A one-point island bounded by two kilometre-scale recording gaps. */
export function makeGpsGapIslandGpx(): GpxFixture {
  const originLng = 13.6
  const latitude = 52.5
  const startMs = Date.UTC(2025, 9, 4, 14, 0, 0)
  const positions = [
    ...Array.from({ length: 7 }, (_, index) => index * 10),
    1_452.9,
    -106.4,
    -96.4,
    -86.4,
    -76.4,
    -66.4,
  ]
  const timestamps = [
    ...Array.from({ length: 7 }, (_, index) => startMs + index * 1_000),
    startMs + 54_000,
    startMs + 92_000,
    startMs + 93_000,
    startMs + 94_000,
    startMs + 95_000,
    startMs + 96_000,
  ]
  const trkpts = positions
    .map((xM, index) =>
      gpsFixturePoint(
        gpsLongitudeForMeters(originLng, latitude, xM),
        latitude,
        timestamps[index]!,
        index === 7
          ? { accuracyM: 49.3, speedMps: 38.8 }
          : index === 8
            ? { accuracyM: 4.3, speedMps: 0.3 }
            : { accuracyM: 3, speedMps: 10 }
      )
    )
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>GPS gap island fixture</name><type>Walking</type><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>
`
  return {
    name: "gps-gap-island-e2e.gpx",
    buffer: Buffer.from(xml, "utf8"),
    mimeType: "application/gpx+xml",
  }
}

/** A displaced island followed by a long coherent fragment after a gap. */
export function makeGpsRecoveredFragmentGpx(): GpxFixture {
  const originLng = 13.7
  const latitude = 52.5
  const startMs = Date.UTC(2025, 9, 4, 11, 52, 0)
  const positions = [
    ...Array.from({ length: 6 }, (_, index) => index * 10),
    299,
    309,
    593.6,
    603.6,
    613.6,
    623.6,
    633.6,
  ]
  const timestamps = [
    ...Array.from({ length: 6 }, (_, index) => startMs + index * 1_000),
    startMs + 31_000,
    startMs + 32_000,
    startMs + 2_110_000,
    startMs + 2_111_000,
    startMs + 2_112_000,
    startMs + 2_113_000,
    startMs + 2_114_000,
  ]
  const trkpts = positions
    .map((xM, index) =>
      gpsFixturePoint(
        gpsLongitudeForMeters(originLng, latitude, xM),
        latitude,
        timestamps[index]!
      )
    )
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fogofwalk-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>GPS recovered fragment fixture</name><type>Walking</type><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>
`
  return {
    name: "gps-recovered-fragment-e2e.gpx",
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
