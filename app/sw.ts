/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies"
import { ExpirationPlugin } from "workbox-expiration"
import { CacheableResponsePlugin } from "workbox-cacheable-response"
import {
  TRAIL_CACHE_MAX_AGE_SECONDS,
  TRAIL_CACHE_MAX_ENTRIES,
  TRAIL_CACHE_NAME,
  TRAIL_PROVIDER_HOSTNAMES,
  TRAIL_PROVIDER_TILE_PATH_PREFIX,
} from "~/constants/trails"

declare let self: ServiceWorkerGlobalScope & typeof globalThis

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Waymarked Trails JSON: cache only the exact provider hosts and zoom-12 tile
// path before the generic map tile rule below sees the shared `/tiles/` path.
registerRoute(
  ({ request, url }) =>
    request.method === "GET" &&
    TRAIL_PROVIDER_HOSTNAMES.some((hostname) => hostname === url.hostname) &&
    url.pathname.startsWith(TRAIL_PROVIDER_TILE_PATH_PREFIX) &&
    url.pathname.endsWith(".json"),
  new CacheFirst({
    cacheName: TRAIL_CACHE_NAME,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: TRAIL_CACHE_MAX_ENTRIES,
        maxAgeSeconds: TRAIL_CACHE_MAX_AGE_SECONDS,
      }),
    ],
  })
)

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
// buffer the files into Cache Storage, then redirect to /map?from-share
// so the main app can pick them up after it loads.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (
    url.pathname === "/map" &&
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
        return Response.redirect("/map?from-share", 303)
      })()
    )
  }
})
