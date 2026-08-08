/**
 * Request-body plumbing for uploads: a size cap applied *while* reading, and
 * a gunzip that cannot be turned into a zip bomb.
 */

import { MAX_TRACK_BYTES } from "~shared/constants"

/** Ratio a well-formed track never approaches; well under gzip's ~1000×. */
const MAX_DECOMPRESSION_RATIO = 20

export class BodyTooLargeError extends Error {
  constructor() {
    super("body exceeds MAX_TRACK_BYTES")
    this.name = "BodyTooLargeError"
  }
}

/**
 * Reads the body, aborting as soon as the cap is exceeded rather than after —
 * an 8 GB upload never gets buffered. `Content-Length` is checked first when
 * present, which rejects most oversized uploads without reading a byte, but it
 * is only a hint: the streaming cap is what actually enforces the limit.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number = MAX_TRACK_BYTES
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError()
  }

  const body = request.body
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/**
 * Streaming gunzip with a hard output cap. `Bun.gunzipSync` would be shorter
 * but has no limit, so a 1 MB body could expand to gigabytes before returning.
 * `DecompressionStream` is a Bun built-in — no `node:zlib`.
 */
export async function gunzipCapped(
  bytes: Uint8Array,
  maxBytes: number = MAX_TRACK_BYTES * MAX_DECOMPRESSION_RATIO
): Promise<Uint8Array<ArrayBuffer>> {
  const source = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))

  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
