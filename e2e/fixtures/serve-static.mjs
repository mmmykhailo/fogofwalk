import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("../../build/", import.meta.url)))
const fixtureArchive = resolve(
  fileURLToPath(new URL("./trails-v1.pmtiles", import.meta.url))
)
const fixtureArchiveUrl = "/map-data/trails/v1/trails-v1.pmtiles"
const port = Number(process.env.PORT ?? 4173)
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}

function rangeForHeader(value, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value ?? "")
  if (!match) return null
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function fileForRequest(requestPath) {
  if (requestPath === fixtureArchiveUrl) return fixtureArchive
  const candidate = normalize(join(root, requestPath))
  if (
    candidate.startsWith(root) &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
  ) {
    return candidate
  }
  return join(root, "index.html")
}

createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url ?? "/").split("?")[0])
  const filePath = fileForRequest(requestPath)
  const fileSize = statSync(filePath).size
  const byteRange = rangeForHeader(request.headers.range, fileSize)
  const isArchive = filePath === fixtureArchive
  response.statusCode = byteRange ? 206 : 200
  response.setHeader(
    "Content-Type",
    contentTypes[extname(filePath)] ?? "application/octet-stream"
  )
  response.setHeader(
    "Content-Length",
    String(byteRange ? byteRange.end - byteRange.start + 1 : fileSize)
  )
  if (isArchive) {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Accept-Ranges", "bytes")
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  }
  if (byteRange) {
    response.setHeader(
      "Content-Range",
      `bytes ${byteRange.start}-${byteRange.end}/${fileSize}`
    )
  }
  if (request.method === "HEAD") {
    response.end()
    return
  }
  createReadStream(
    filePath,
    byteRange ? { start: byteRange.start, end: byteRange.end } : undefined
  ).pipe(response)
}).listen(port, "127.0.0.1", () => {
  console.log(`static server listening on ${port}`)
})
