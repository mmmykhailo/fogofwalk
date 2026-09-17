import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("../../build/", import.meta.url)))
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

function fileForRequest(requestPath) {
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
  response.statusCode = 200
  response.setHeader(
    "Content-Type",
    contentTypes[extname(filePath)] ?? "application/octet-stream"
  )
  response.setHeader("Content-Length", String(fileSize))
  if (request.method === "HEAD") {
    response.end()
    return
  }
  createReadStream(filePath).pipe(response)
}).listen(port, "127.0.0.1", () => {
  console.log(`static server listening on ${port}`)
})
