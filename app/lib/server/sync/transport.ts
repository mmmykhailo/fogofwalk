import type {
  ActivityMeta,
  ActivityTombstone,
  ActivityUploadPayload,
  ActivityUploadRequestPayload,
  ManifestPage,
} from "~shared/api"
import { MAX_ACTIVITY_BYTES, SYNC_PAGE_SIZE } from "~shared/constants"
import type { ParsedActivity } from "~/types/activities"
import { computeContentHashCandidates } from "~/lib/activityHash"
import { flattenActivityPaths } from "~shared/activityContract"
import { apiRaw, apiSend } from "../apiClient"
import { throwIfSyncAborted } from "./cancellation"

const MAX_MANIFEST_ROWS = SYNC_PAGE_SIZE * 4
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_PAYLOAD_BYTES = MAX_ACTIVITY_BYTES * 20
const HASH_PATTERN = /^[0-9a-f]{64}$/

export type SyncTransportErrorCode =
  | "invalid-manifest"
  | "invalid-payload"
  | "payload-too-large"

export type SyncTransportError = Error & {
  readonly name: "SyncTransportError"
  readonly code: SyncTransportErrorCode
  readonly retryable: boolean
}

export function createSyncTransportError(
  code: SyncTransportErrorCode,
  message: string,
  options: { retryable?: boolean } = {}
): SyncTransportError {
  const error = new Error(message) as SyncTransportError
  Object.assign(error, {
    name: "SyncTransportError",
    code,
    retryable: options.retryable ?? false,
  })
  return error
}

export function isSyncTransportError(
  error: unknown
): error is SyncTransportError {
  return (
    error instanceof Error &&
    error.name === "SyncTransportError" &&
    typeof (error as Partial<SyncTransportError>).code === "string" &&
    typeof (error as Partial<SyncTransportError>).retryable === "boolean"
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value)
}

function isActivityType(value: unknown): boolean {
  return (
    value === undefined ||
    value === "walking" ||
    value === "running" ||
    value === "cycling" ||
    value === "kayaking" ||
    value === "swimming" ||
    value === "other"
  )
}

function isSunPhase(value: unknown): boolean {
  return (
    value === undefined ||
    value === "before_sunrise" ||
    value === "daylight" ||
    value === "after_sunset" ||
    value === "unknown"
  )
}

function isFormat(value: unknown): value is "gpx" | "fit" {
  return value === "gpx" || value === "fit"
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  )
}

function isCoordinatePath(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.every(isCoordinate)
}

function hasValidGeometry(value: Record<string, unknown>): boolean {
  const hasCoordinates = Array.isArray(value.coordinates)
  const hasPaths = Array.isArray(value.paths)
  if (hasCoordinates === hasPaths) return false
  if (hasCoordinates && !isCoordinatePath(value.coordinates)) return false
  if (
    hasPaths &&
    (!Array.isArray(value.paths) ||
      !(value.paths as unknown[]).every(
        (path: unknown) => isCoordinatePath(path) && path.length >= 2
      ))
  ) {
    return false
  }

  if (Array.isArray(value.pointTimestamps)) {
    if (
      !hasCoordinates ||
      value.pointTimestamps.length !==
        (value.coordinates as unknown[]).length ||
      !value.pointTimestamps.every(isFiniteNumber)
    ) {
      return false
    }
  }
  if (Array.isArray(value.pathTimestamps)) {
    if (
      !hasPaths ||
      value.pathTimestamps.length !== (value.paths as unknown[]).length ||
      !value.pathTimestamps.every(
        (timestamps, index) =>
          Array.isArray(timestamps) &&
          timestamps.length === (value.paths as unknown[][])[index]!.length &&
          timestamps.every(isNullableFiniteNumber)
      )
    ) {
      return false
    }
  }
  return (
    !(hasCoordinates && value.pathTimestamps !== undefined) &&
    !(hasPaths && value.pointTimestamps !== undefined)
  )
}

function hasValidStats(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.distanceKm) &&
    isFiniteNumber(value.uniqueDistanceKm) &&
    isFiniteNumber(value.elevationGainM) &&
    isFiniteNumber(value.elevationLossM) &&
    typeof value.hasElevation === "boolean" &&
    isNullableFiniteNumber(value.durationMs) &&
    isNullableFiniteNumber(value.movingTimeMs) &&
    isNullableFiniteNumber(value.avgPaceMinPerKm) &&
    isNullableFiniteNumber(value.avgMovingPaceMinPerKm) &&
    isNullableFiniteNumber(value.avgSpeedKmh) &&
    isNullableFiniteNumber(value.avgMovingSpeedKmh) &&
    Array.isArray(value.elevationProfile) &&
    value.elevationProfile.every(
      (point) =>
        isObject(point) &&
        isFiniteNumber(point.distanceKm) &&
        isFiniteNumber(point.elevationM)
    )
  )
}

function isValidActivityMeta(value: unknown): value is ActivityMeta {
  if (!isObject(value)) return false
  return (
    isHash(value.contentHash) &&
    typeof value.name === "string" &&
    value.name.length <= 512 &&
    typeof value.isPublic === "boolean" &&
    isFormat(value.format) &&
    isActivityType(value.activityType) &&
    isSunPhase(value.startSunPhase) &&
    isNullableFiniteNumber(value.startedAtMs) &&
    isFiniteNumber(value.distanceKm) &&
    typeof value.pointCount === "number" &&
    Number.isSafeInteger(value.pointCount) &&
    value.pointCount >= 0 &&
    isFiniteNumber(value.sizeBytes) &&
    value.sizeBytes >= 0 &&
    isFiniteNumber(value.updatedAt) &&
    isNullableFiniteNumber(value.durationMs) &&
    isNullableFiniteNumber(value.movingTimeMs) &&
    isFiniteNumber(value.elevationGainM) &&
    isNullableFiniteNumber(value.avgMovingSpeedKmh)
  )
}

function isValidTombstone(value: unknown): value is ActivityTombstone {
  return (
    isObject(value) &&
    isHash(value.contentHash) &&
    isFiniteNumber(value.deletedAt) &&
    value.deletedAt >= 0
  )
}

export function parseManifestPage(value: unknown): ManifestPage {
  if (!isObject(value)) {
    throw createSyncTransportError(
      "invalid-manifest",
      "The server returned an invalid activity manifest."
    )
  }
  const activities = value.activities
  const deletions = value.deletions
  if (
    !Array.isArray(activities) ||
    !Array.isArray(deletions) ||
    activities.length + deletions.length > MAX_MANIFEST_ROWS ||
    !activities.every(isValidActivityMeta) ||
    !deletions.every(isValidTombstone) ||
    !isFiniteNumber(value.cursor) ||
    value.cursor < 0 ||
    typeof value.hasMore !== "boolean"
  ) {
    throw createSyncTransportError(
      "invalid-manifest",
      "The server returned an invalid activity manifest."
    )
  }
  return {
    activities: [...activities],
    deletions: [...deletions],
    cursor: value.cursor,
    hasMore: value.hasMore,
  }
}

export function parseActivityPayload(value: unknown): ActivityUploadPayload {
  const object = isObject(value)
  const basic =
    object &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 512 &&
    isNullableFiniteNumber(value.startedAtMs) &&
    isFormat(value.format) &&
    isActivityType(value.activityType) &&
    isSunPhase(value.startSunPhase)
  const geometry = object && hasValidGeometry(value)
  const stats = object && hasValidStats(value.stats)
  if (!basic || !geometry || !stats) {
    throw createSyncTransportError(
      "invalid-payload",
      "The server returned an invalid activity payload."
    )
  }
  if (value.laps !== undefined && !Array.isArray(value.laps)) {
    throw createSyncTransportError(
      "invalid-payload",
      "The server returned invalid activity lap data."
    )
  }
  return value as unknown as ActivityUploadPayload
}

function payloadAsParsedActivity(
  payload: ActivityUploadPayload
): ParsedActivity {
  const coordinates =
    "coordinates" in payload && payload.coordinates
      ? payload.coordinates
      : flattenActivityPaths(payload.paths ?? [])
  return {
    ...payload,
    id: "remote-payload",
    coordinates,
  } as ParsedActivity
}

export async function validateActivityPayloadHash(
  contentHash: string,
  payload: ActivityUploadPayload,
  signal?: AbortSignal
): Promise<void> {
  throwIfSyncAborted(signal)
  if (!isHash(contentHash)) {
    throw createSyncTransportError(
      "invalid-payload",
      "The downloaded activity has an invalid content hash."
    )
  }
  const candidates = await computeContentHashCandidates(
    payloadAsParsedActivity(payload)
  )
  throwIfSyncAborted(signal)
  if (!candidates.includes(contentHash)) {
    throw createSyncTransportError(
      "invalid-payload",
      "The downloaded activity does not match its content hash."
    )
  }
}

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  invalidCode: SyncTransportErrorCode
): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw createSyncTransportError(
      "payload-too-large",
      invalidCode === "invalid-manifest"
        ? "The activity manifest is too large to process."
        : "The downloaded activity is too large to process."
    )
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw createSyncTransportError(
      invalidCode,
      invalidCode === "invalid-manifest"
        ? "The server returned invalid manifest JSON."
        : "The server returned invalid activity JSON."
    )
  }
}

export interface SyncTransport {
  fetchActivityManifest(
    since: number,
    signal?: AbortSignal
  ): Promise<ManifestPage>
  downloadActivity(
    contentHash: string,
    signal?: AbortSignal
  ): Promise<{ meta?: ActivityMeta; payload: ActivityUploadPayload }>
  uploadActivity(activity: ParsedActivity, signal?: AbortSignal): Promise<void>
  deleteActivity(contentHash: string, signal?: AbortSignal): Promise<number>
}

/**
 * Project the compatibility-shaped local record onto the unambiguous wire
 * shape. New local records carry both `paths` and flattened `coordinates` so
 * older render consumers keep working, but the server accepts exactly one
 * geometry representation per upload.
 */
export function toActivityUploadPayload(
  activity: ParsedActivity
): ActivityUploadRequestPayload {
  const {
    id: _id,
    coordinates: _coordinates,
    paths: _paths,
    pointTimestamps: _pointTimestamps,
    pathTimestamps: _pathTimestamps,
    ...metadata
  } = activity
  const stats = { ...activity.stats, uniqueDistanceKm: 0 }
  if (activity.paths && activity.paths.length > 0) {
    return {
      ...metadata,
      paths: activity.paths,
      ...(activity.pathTimestamps
        ? { pathTimestamps: activity.pathTimestamps }
        : {}),
      stats,
    }
  }
  return {
    ...metadata,
    coordinates: activity.coordinates,
    ...(activity.pointTimestamps
      ? { pointTimestamps: activity.pointTimestamps }
      : {}),
    stats,
  }
}

async function gzipJson(value: unknown): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw createSyncTransportError(
      "invalid-payload",
      "This browser cannot compress activity uploads.",
      { retryable: true }
    )
  }
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  return new Response(stream).blob()
}

export function createApiSyncTransport(): SyncTransport {
  return {
    async fetchActivityManifest(since, signal) {
      throwIfSyncAborted(signal)
      const response = await apiRaw(
        "GET",
        `/api/activities/manifest?since=${encodeURIComponent(String(since))}`,
        { signal }
      )
      throwIfSyncAborted(signal)
      const value = await readJsonResponse(
        response,
        MAX_MANIFEST_BYTES,
        "invalid-manifest"
      )
      throwIfSyncAborted(signal)
      return parseManifestPage(value)
    },

    async downloadActivity(contentHash, signal) {
      throwIfSyncAborted(signal)
      const response = await apiRaw(
        "GET",
        `/api/activities/${encodeURIComponent(contentHash)}`,
        { signal }
      )
      throwIfSyncAborted(signal)
      const value = await readJsonResponse(
        response,
        MAX_PAYLOAD_BYTES,
        "invalid-payload"
      )
      const payload = parseActivityPayload(value)
      await validateActivityPayloadHash(contentHash, payload, signal)
      return { payload }
    },

    async uploadActivity(activity, signal) {
      throwIfSyncAborted(signal)
      const payload: ActivityUploadRequestPayload =
        toActivityUploadPayload(activity)
      const body = await gzipJson(payload)
      throwIfSyncAborted(signal)
      if (body.size > MAX_ACTIVITY_BYTES) {
        throw createSyncTransportError(
          "payload-too-large",
          "That activity is too large to upload."
        )
      }
      await apiSend("PUT", `/api/activities/${activity.contentHash}`, {
        rawBody: body,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        signal,
      })
      throwIfSyncAborted(signal)
    },

    async deleteActivity(contentHash, signal) {
      throwIfSyncAborted(signal)
      const response = await apiRaw(
        "DELETE",
        `/api/activities/${encodeURIComponent(contentHash)}`,
        { signal }
      )
      throwIfSyncAborted(signal)
      const value = await readJsonResponse(
        response,
        64 * 1024,
        "invalid-payload"
      )
      if (
        !isObject(value) ||
        !isFiniteNumber(value.deletedAt) ||
        value.deletedAt < 0
      ) {
        throw createSyncTransportError(
          "invalid-payload",
          "The server returned an invalid deletion response."
        )
      }
      throwIfSyncAborted(signal)
      return value.deletedAt
    },
  }
}
