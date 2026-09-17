import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { Page, Request } from "@playwright/test"

export const TRAIL_ARCHIVE_URL =
  "http://127.0.0.1:4173/map-data/trails/v1/trails-v1.pmtiles"
export const TRAIL_FIXTURE_PATH = fileURLToPath(
  new URL("./trails-v1.pmtiles", import.meta.url)
)
export const TRAIL_TEST_ZOOM = 12
export const TRAIL_TEST_CENTER: [number, number] = [14.42, 50.08]

export type TrailArchiveMode =
  | "success"
  | "http"
  | "not-found"
  | "range"
  | "truncated"
  | "cors"
  | "invalid-pmtiles"
  | "offline"

export interface TrailArchiveRequest {
  method: string
  range: string | null
  status: number
  url: string
  authorization: string | null
  cookie: string | null
}

interface TrailArchiveState {
  mode: TrailArchiveMode
}

interface ByteRange {
  start: number
  end: number
}

function parseByteRange(
  value: string | undefined,
  length: number
): ByteRange | null {
  if (!value) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim())
  if (!match) return null

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : length - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= length ||
    requestedEnd < start
  ) {
    return null
  }

  return { start, end: Math.min(requestedEnd, length - 1) }
}

function requestRecord(request: Request, status: number): TrailArchiveRequest {
  const headers = request.headers()
  return {
    method: request.method(),
    range: headers.range ?? null,
    status,
    url: request.url(),
    authorization: headers.authorization ?? null,
    cookie: headers.cookie ?? null,
  }
}

/**
 * Serves the checked-in archive through the same range-oriented contract as
 * the production static host. The route is deliberately opt-in: ordinary E2E
 * tests can only observe a denylisted external trail request, while trail
 * tests explicitly install this local archive handler.
 */
export async function installTrailArchive(page: Page) {
  const archive = await readFile(TRAIL_FIXTURE_PATH)
  const requests: TrailArchiveRequest[] = []
  const state: TrailArchiveState = { mode: "success" }

  await page.route(TRAIL_ARCHIVE_URL, async (route) => {
    const request = route.request()
    const rangeHeader = request.headers().range ?? null

    if (state.mode === "offline") {
      requests.push(requestRecord(request, 0))
      await route.abort("failed")
      return
    }

    if (state.mode === "http") {
      requests.push(requestRecord(request, 500))
      await route.fulfill({
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "synthetic trail archive failure",
      })
      return
    }

    if (state.mode === "not-found") {
      requests.push(requestRecord(request, 404))
      await route.fulfill({
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "synthetic trail archive missing",
      })
      return
    }

    if (request.method() === "HEAD") {
      requests.push(requestRecord(request, 200))
      await route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Accept-Ranges": "bytes",
          "Content-Length": String(archive.length),
          ETag: '"trails-v1"',
          "Content-Type": "application/octet-stream",
        },
      })
      return
    }

    const byteRange = parseByteRange(rangeHeader ?? undefined, archive.length)
    if (!byteRange) {
      requests.push(requestRecord(request, 416))
      await route.fulfill({
        status: 416,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Range": `bytes */${archive.length}`,
        },
      })
      return
    }

    let body = Buffer.from(archive.subarray(byteRange.start, byteRange.end + 1))
    if (state.mode === "truncated" && body.length > 1) {
      body = body.subarray(0, Math.max(1, Math.floor(body.length / 2)))
    }
    if (state.mode === "invalid-pmtiles" && body.length > 0) {
      body[0] = body[0]! ^ 0xff
    }

    const status = state.mode === "range" ? 200 : 206
    requests.push(requestRecord(request, status))
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Length": String(body.length),
      "Content-Range": `bytes ${byteRange.start}-${
        state.mode === "truncated"
          ? byteRange.end
          : byteRange.start + body.length - 1
      }/${archive.length}`,
      ETag: '"trails-v1"',
      "Content-Type": "application/octet-stream",
    }
    if (state.mode !== "cors") headers["Access-Control-Allow-Origin"] = "*"
    await route.fulfill({
      status,
      headers,
      body,
    })
  })

  return { archive, requests, state }
}

/** Observe a real static archive route without replacing its responses. */
export function observeTrailArchive(page: Page) {
  const requests: TrailArchiveRequest[] = []

  page.on("response", (response) => {
    if (response.url() !== TRAIL_ARCHIVE_URL) return
    requests.push(requestRecord(response.request(), response.status()))
  })
  page.on("requestfailed", (request) => {
    if (request.url() !== TRAIL_ARCHIVE_URL) return
    requests.push(requestRecord(request, 0))
  })

  return { requests }
}
