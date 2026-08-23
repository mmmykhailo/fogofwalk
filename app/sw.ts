/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies"
import { ExpirationPlugin } from "workbox-expiration"

declare let self: ServiceWorkerGlobalScope & typeof globalThis

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Map tiles: long-lived CacheFirst (e.g. OpenFreeMap vector tiles)
registerRoute(
  ({ url }) =>
    url.pathname.includes("/tiles/") || url.pathname.endsWith(".pmtiles"),
  new CacheFirst({
    cacheName: "map-tiles",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      }),
    ],
  })
)

// Map style JSON: StaleWhileRevalidate so updates are picked up next load
registerRoute(
  ({ url }) => url.pathname.endsWith(".json"),
  new StaleWhileRevalidate({ cacheName: "map-styles" })
)

// Web Share Target: intercept the POST from the system share sheet,
// buffer the files into Cache Storage, then redirect to /?from-share
// so the main app can pick them up after it loads.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (
    url.pathname === "/" &&
    url.searchParams.has("share-target") &&
    event.request.method === "POST"
  ) {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData()
        const files = formData.getAll("files") as File[]
        const cache = await caches.open("share-target-queue")
        for (const file of files) {
          await cache.put(
            new Request(`/share-queue/${encodeURIComponent(file.name)}`),
            new Response(await file.arrayBuffer(), {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "X-File-Name": file.name,
              },
            })
          )
        }
        return Response.redirect("/?from-share", 303)
      })()
    )
  }
})
