import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import type { ParsedTrack } from "~/types/tracks"
import { MAP_STYLE_URL, TRACK_COLOR } from "~/constants/fog"
import { CARD_WIDTH, CARD_HEIGHT } from "~/lib/shareCard"

interface ShareMapViewProps {
  tracks: ParsedTrack[]
  onReady: (
    baseMap: ImageBitmap,
    trackPointsPerTrack: Array<{ x: number; y: number }[]>
  ) => void
}

/**
 * Renders a clean MapLibre map centred on the given tracks and calls onReady
 * once the map is fully captured.
 *
 * Two-phase capture:
 * 1. After base tiles are idle (no track layers): capture the base map bitmap.
 *    This bitmap is safe to blur without blurring the tracks.
 * 2. Add one layer per track, wait for the second idle, then project each
 *    track's coordinates to canvas pixels. One pixel array per track is
 *    returned so callers can draw them as separate paths.
 *
 * The container is positioned off-screen so the map renders without being
 * visible to the user.
 */
export function ShareMapView({ tracks, onReady }: ShareMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  })

  // Stable dep — only rebuild map when the actual track set changes,
  // not on every parent render (tracks array reference changes each time).
  const trackIds = tracks.map((t) => t.id).join(",")

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      attributionControl: false,
    })

    let captured = false

    // 10-second fallback in case the map never reaches idle (e.g. offline)
    const fallbackTimer = setTimeout(() => {
      if (captured) return
      captured = true
      console.warn("[ShareMapView] map did not reach idle within 10 s — emitting partial capture")
      createImageBitmap(map.getCanvas()).then((bitmap) => {
        onReadyRef.current(bitmap, tracks.map(() => []))
      })
    }, 10_000)

    map.once("load", () => {
      // ── Compute combined bounds of all tracks ─────────────────────────────
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
      for (const t of tracks) {
        for (const [lng, lat] of t.coordinates) {
          if (lng < minLng) minLng = lng
          if (lng > maxLng) maxLng = lng
          if (lat < minLat) minLat = lat
          if (lat > maxLat) maxLat = lat
        }
      }

      // Asymmetric padding: reserve bottom ~520px for the stats panel so the
      // track(s) stay in the upper portion of the card.
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: { top: 100, bottom: 520, left: 80, right: 80 },
        animate: false,
      })

      // ── Phase 1: base map idle (no track layers yet) ──────────────────────
      map.once("idle", async () => {
        if (captured) return

        const baseMapBitmap = await createImageBitmap(map.getCanvas())

        // Add one source + layer per track
        tracks.forEach((t, i) => {
          map.addSource(`share-track-${i}`, {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: { type: "LineString", coordinates: t.coordinates as [number, number][] },
              properties: {},
            },
          })
          map.addLayer({
            id: `share-track-line-${i}`,
            type: "line",
            source: `share-track-${i}`,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": TRACK_COLOR, "line-width": 4, "line-opacity": 0.95 },
          })
        })

        // ── Phase 2: all track layers idle → project pixel coords ─────────
        map.once("idle", () => {
          if (captured) return
          captured = true
          clearTimeout(fallbackTimer)

          const MAX_PTS = 2000
          const trackPointsPerTrack = tracks.map((t) => {
            const { coordinates } = t
            const step = coordinates.length > MAX_PTS ? Math.ceil(coordinates.length / MAX_PTS) : 1
            return coordinates
              .filter((_, i) => i % step === 0)
              .map(([lng, lat]) => {
                const pt = map.project([lng, lat] as [number, number])
                return { x: pt.x, y: pt.y }
              })
          })

          onReadyRef.current(baseMapBitmap, trackPointsPerTrack)
        })
      })
    })

    return () => {
      clearTimeout(fallbackTimer)
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIds])

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{
        position: "fixed",
        left: -9999,
        top: -9999,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        pointerEvents: "none",
      }}
    />
  )
}
