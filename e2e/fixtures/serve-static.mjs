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

createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url ?? "/").split("?")[0])
  const candidate = normalize(join(root, requestPath))
  const filePath =
    candidate.startsWith(root) &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
      ? candidate
      : join(root, "index.html")
  response.statusCode = candidate === filePath ? 200 : 200
  response.setHeader(
    "Content-Type",
    contentTypes[extname(filePath)] ?? "application/octet-stream"
  )
  createReadStream(filePath).pipe(response)
}).listen(port, "127.0.0.1", () => {
  console.log(`static server listening on ${port}`)
})
