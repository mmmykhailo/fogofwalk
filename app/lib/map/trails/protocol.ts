import maplibregl from "maplibre-gl"
import {
  TRAIL_DATA_ZOOM,
  TRAIL_DIAGNOSTIC_OPERATION_IDS,
  TRAIL_DIAGNOSTIC_STAGE,
  TRAIL_FETCH_TIMEOUT_MS,
  TRAIL_MAX_RESPONSE_BYTES,
  TRAIL_PROVIDER_BASE_URLS,
  TRAIL_PROTOCOL_NAME,
  TRAIL_THEMES,
} from "~/constants/trails"
import { createEmptyTrailTile, encodeTrailTile } from "~/lib/map/trails/encode"
import { normalizeTrailTile } from "~/lib/map/trails/normalize"
import {
  TrailTileError,
  type TrailErrorCode,
  type TrailNormalizationStats,
  type TrailTheme,
  type TrailTileCoordinate,
} from "~/lib/map/trails/types"
import { recordDiagnostic } from "~/lib/diagnostics"

type DiagnosticOperation = keyof typeof TRAIL_DIAGNOSTIC_OPERATION_IDS
type DiagnosticStats = Partial<TrailNormalizationStats> & {
  byteLength?: number
}

const reportedDiagnosticKeys = new Set<string>()
let isProtocolRegistered = false

function isTrailTheme(value: string): value is TrailTheme {
  return (TRAIL_THEMES as readonly string[]).includes(value)
}

function parseIntegerSegment(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function diagnosticRetryability(code: TrailErrorCode) {
  if (code === "http_error" || code === "timeout") return "retryable" as const
  if (code === "encode_failed") return "unknown" as const
  return "permanent" as const
}

function reportOnce(
  operation: DiagnosticOperation,
  code: TrailErrorCode,
  stats?: DiagnosticStats
): void {
  const key = `${operation}:${code}`
  if (reportedDiagnosticKeys.has(key)) return
  reportedDiagnosticKeys.add(key)

  recordDiagnostic({
    subsystem: "render",
    operationId: TRAIL_DIAGNOSTIC_OPERATION_IDS[operation],
    stage: TRAIL_DIAGNOSTIC_STAGE,
    result: "degraded",
    errorCode: code,
    retryability: diagnosticRetryability(code),
    geometry: {
      byteLength: stats?.byteLength,
      featureCount: stats?.inputFeatures,
      vertexCount: stats?.coordinateCount,
    },
  })
}

function trailErrorCode(error: unknown): TrailErrorCode {
  return error instanceof TrailTileError ? error.code : "http_error"
}

function parseJson(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new TrailTileError("invalid_json")
  }
}

function declaredResponseLength(headers: Headers): number | undefined {
  const value = headers.get("content-length")
  if (value === null) return undefined
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 0) return undefined
  if (length > TRAIL_MAX_RESPONSE_BYTES) {
    throw new TrailTileError("payload_too_large")
  }
  return length
}

function enforceActualResponseLength(body: ArrayBuffer): void {
  if (body.byteLength > TRAIL_MAX_RESPONSE_BYTES) {
    throw new TrailTileError("payload_too_large")
  }
}

function createMapAbortError(): Error {
  const error = new Error("MapLibre request aborted")
  error.name = "AbortError"
  return error
}

function encodeNormalizedTrailTile(
  normalized: Parameters<typeof encodeTrailTile>[0],
  tile: TrailTileCoordinate
): ArrayBuffer {
  try {
    return encodeTrailTile(normalized, tile)
  } catch {
    throw new TrailTileError("encode_failed", normalized.stats)
  }
}

export function parseTrailProtocolUrl(url: string): TrailTileCoordinate | null {
  const escapedProtocol = TRAIL_PROTOCOL_NAME.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  )
  const match = new RegExp(
    `^${escapedProtocol}://([^/]+)/([^/]+)/([^/]+)/([^/]+)$`
  ).exec(url)
  if (!match || match[0] !== url) return null

  const themeSegment = match[1]
  const zSegment = match[2]
  const xSegment = match[3]
  const ySegment = match[4]
  if (
    !themeSegment ||
    !zSegment ||
    !xSegment ||
    !ySegment ||
    !isTrailTheme(themeSegment)
  ) {
    return null
  }

  const z = parseIntegerSegment(zSegment)
  const x = parseIntegerSegment(xSegment)
  const y = parseIntegerSegment(ySegment)
  if (z !== TRAIL_DATA_ZOOM || x === null || y === null) return null

  const tilesAtZoom = 2 ** TRAIL_DATA_ZOOM
  if (x < 0 || x >= tilesAtZoom || y < 0 || y >= tilesAtZoom) return null

  return { theme: themeSegment, z: TRAIL_DATA_ZOOM, x, y }
}

export function providerUrlForTrailTile(tile: TrailTileCoordinate): string {
  return `${TRAIL_PROVIDER_BASE_URLS[tile.theme]}/${tile.z}/${tile.x}/${tile.y}.json`
}

export async function loadTrailTile(
  request: maplibregl.RequestParameters,
  mapAbortController: AbortController
): Promise<{ data: ArrayBuffer }> {
  const tile = parseTrailProtocolUrl(request.url)
  if (!tile) {
    reportOnce("protocol", "invalid_protocol_url")
    return { data: createEmptyTrailTile() }
  }

  if (mapAbortController.signal.aborted) throw createMapAbortError()

  const requestController = new AbortController()
  let timeoutFired = false
  let observedByteLength: number | undefined
  const forwardAbort = () => requestController.abort()
  mapAbortController.signal.addEventListener("abort", forwardAbort, {
    once: true,
  })
  const timeoutId = setTimeout(() => {
    timeoutFired = true
    requestController.abort()
  }, TRAIL_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(providerUrlForTrailTile(tile), {
      signal: requestController.signal,
      credentials: "omit",
      mode: "cors",
    })
    if (timeoutFired) throw new TrailTileError("timeout")
    if (!response.ok) throw new TrailTileError("http_error")

    observedByteLength = declaredResponseLength(response.headers)
    const body = await response.arrayBuffer()
    observedByteLength = body.byteLength
    enforceActualResponseLength(body)
    const parsed = parseJson(body)
    const normalized = normalizeTrailTile(parsed, tile.theme)
    if (timeoutFired) throw new TrailTileError("timeout")
    if (mapAbortController.signal.aborted) throw createMapAbortError()
    return { data: encodeNormalizedTrailTile(normalized, tile) }
  } catch (error) {
    if (mapAbortController.signal.aborted) throw error
    const code = timeoutFired ? "timeout" : trailErrorCode(error)
    const stats = error instanceof TrailTileError ? error.stats : undefined
    reportOnce(tile.theme, code, { ...stats, byteLength: observedByteLength })
    return { data: createEmptyTrailTile() }
  } finally {
    clearTimeout(timeoutId)
    mapAbortController.signal.removeEventListener("abort", forwardAbort)
  }
}

export function registerTrailProtocol(): void {
  if (isProtocolRegistered) return
  maplibregl.addProtocol(TRAIL_PROTOCOL_NAME, loadTrailTile)
  isProtocolRegistered = true
}

export function unregisterTrailProtocolForTests(): void {
  if (isProtocolRegistered) {
    maplibregl.removeProtocol(TRAIL_PROTOCOL_NAME)
    isProtocolRegistered = false
  }
  reportedDiagnosticKeys.clear()
}
