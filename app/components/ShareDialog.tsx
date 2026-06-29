import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { CaretLeftIcon, CaretRightIcon, CopyIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react"
import type { ParsedTrack } from "~/types/tracks"
import type { PhotoEntry } from "~/types/photos"
import { mapStore } from "~/lib/mapStore"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import {
  type StatKey,
  type StatsData,
  type BackgroundMode,
  STAT_DEFS,
  CARD_WIDTH,
  CARD_HEIGHT,
  computeCompositeStats,
  trackToStatsData,
  compositeToStatsData,
  drawShareCard,
  exportShareCard,
  copyShareCard,
  getAvailableStats,
  getDefaultStats,
  filterPhotosForTrack,
  filterPhotosForTracks,
  type ShareCardOptions,
} from "~/lib/shareCard"
import { ShareMapView } from "~/components/ShareMapView"

const PREVIEW_W = 270
const PREVIEW_H = 360
const MAX_SELECTED = 4
const BLUR_PRESETS = [0, 2, 4, 6, 8, 12, 20]

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tracks: ParsedTrack[]
  uniqueKms: Map<string, number>
  photos: PhotoEntry[]
}

function useShareMapSnapshot(
  backgroundMode: BackgroundMode,
  isSingle: boolean,
  trackId: string | undefined
) {
  const [mapBaseSnapshot, setMapBaseSnapshot] = useState<ImageBitmap | null>(null)
  const [mapTrackPointsPerTrack, setMapTrackPointsPerTrack] = useState<
    Array<{ x: number; y: number }[]> | null
  >(null)
  const [isMapReady, setIsMapReady] = useState(false)

  useEffect(() => {
    if (backgroundMode !== "map") {
      setMapBaseSnapshot((prev) => {
        if (prev) {
          if (!isSingle || mapStore.shareCardCache?.baseMap !== prev) prev.close()
        }
        return null
      })
      setMapTrackPointsPerTrack(null)
      setIsMapReady(false)
      return
    }
    if (isSingle) {
      const cached = mapStore.shareCardCache
      if (cached && cached.trackId === trackId) {
        setMapBaseSnapshot(cached.baseMap)
        setMapTrackPointsPerTrack([cached.trackPoints])
        setIsMapReady(true)
      }
    }
  }, [backgroundMode, isSingle, trackId])

  const handleMapReady = useCallback(
    (baseMap: ImageBitmap, pts: Array<{ x: number; y: number }[]>) => {
      if (isSingle && trackId) {
        const trackPoints = pts[0] ?? []
        if (mapStore.shareCardCache && mapStore.shareCardCache.trackId !== trackId) {
          mapStore.shareCardCache.baseMap.close()
        }
        mapStore.shareCardCache = { trackId, baseMap, trackPoints }
      }
      setMapBaseSnapshot(baseMap)
      setMapTrackPointsPerTrack(pts)
      setIsMapReady(true)
    },
    [isSingle, trackId]
  )

  return { mapBaseSnapshot, mapTrackPointsPerTrack, isMapReady, handleMapReady }
}

export function ShareDialog({
  open,
  onOpenChange,
  tracks,
  uniqueKms,
  photos,
}: ShareDialogProps) {
  const isSingle = tracks.length === 1
  const track = tracks[0]

  const composite = useMemo(
    () => (isSingle ? null : computeCompositeStats(tracks, uniqueKms)),
    [isSingle, tracks, uniqueKms]
  )

  const statsData: StatsData = useMemo(
    () =>
      isSingle
        ? trackToStatsData(track, uniqueKms.get(track.id) ?? 0)
        : compositeToStatsData(composite!),
    [isSingle, track, uniqueKms, composite]
  )

  const availableStats = useMemo(() => getAvailableStats(statsData), [statsData])

  const trackPhotos = useMemo(
    () =>
      isSingle
        ? filterPhotosForTrack(photos, track)
        : filterPhotosForTracks(photos, tracks),
    [isSingle, photos, track, tracks]
  )

  const subtitle = useMemo(() => {
    if (isSingle) return null
    const days = new Set<string>()
    for (const t of tracks) {
      if (t.startedAtMs != null) {
        const d = new Date(t.startedAtMs)
        days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
      }
    }
    const n = tracks.length
    if (days.size === 0) return `${n} tracks`
    if (days.size === 1) return `${n} tracks from a single day`
    return `${n} tracks from ${days.size} days`
  }, [isSingle, tracks])

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() =>
    trackPhotos.length > 0 ? "photo" : "dark"
  )
  const [blurAmount, setBlurAmount] = useState(6)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0)
  const [enabledStats, setEnabledStats] = useState<StatKey[]>(() =>
    getDefaultStats(statsData)
  )
  const [isExporting, setIsExporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const previewRef = useRef<HTMLCanvasElement>(null)

  const { mapBaseSnapshot, mapTrackPointsPerTrack, isMapReady, handleMapReady } =
    useShareMapSnapshot(backgroundMode, isSingle, track?.id)

  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(async () => {
      const canvas = previewRef.current
      if (!canvas) return
      canvas.width = CARD_WIDTH
      canvas.height = CARD_HEIGHT
      const photo = trackPhotos[selectedPhotoIndex] ?? null
      await drawShareCard(canvas, {
        tracks,
        statsData,
        enabledStats,
        subtitle,
        photo,
        mapBaseSnapshot,
        mapTrackPointsPerTrack,
        backgroundMode,
        blurAmount,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [
    open,
    tracks,
    statsData,
    enabledStats,
    trackPhotos,
    selectedPhotoIndex,
    mapBaseSnapshot,
    mapTrackPointsPerTrack,
    backgroundMode,
    blurAmount,
    subtitle,
  ])

  function toggleStat(key: StatKey) {
    setEnabledStats((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev
        return prev.filter((k) => k !== key)
      }
      if (prev.length < MAX_SELECTED) return [...prev, key]
      return [...prev.slice(1), key]
    })
  }

  function buildOpts(): ShareCardOptions {
    return {
      tracks,
      statsData,
      enabledStats,
      subtitle,
      photo: trackPhotos[selectedPhotoIndex] ?? null,
      mapBaseSnapshot,
      mapTrackPointsPerTrack,
      backgroundMode,
      blurAmount,
    }
  }

  async function handleCopy() {
    setIsCopying(true)
    setActionError(null)
    try {
      await copyShareCard(buildOpts())
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Copy failed")
      setTimeout(() => setActionError(null), 4000)
    } finally {
      setIsCopying(false)
    }
  }

  async function handleExport() {
    setIsExporting(true)
    setActionError(null)
    try {
      await exportShareCard(buildOpts())
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed")
      setTimeout(() => setActionError(null), 4000)
    } finally {
      setIsExporting(false)
    }
  }

  const hasPrev = selectedPhotoIndex > 0
  const hasNext = selectedPhotoIndex < trackPhotos.length - 1

  const bgModes: { key: BackgroundMode; label: string }[] = [
    { key: "photo", label: "Photo" },
    { key: "dark", label: "Dark" },
    { key: "map", label: "Map" },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {backgroundMode === "map" && !isMapReady && (
        <ShareMapView tracks={tracks} onReady={handleMapReady} />
      )}

      <DialogContent className="sm:max-w-md" showCloseButton={false} fullscreenOnMobile>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>
              {isSingle ? "Share activity" : `Share ${tracks.length} activities`}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 sm:hidden"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <XIcon weight="bold" />
            </Button>
          </div>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </DialogHeader>

        <div className="flex justify-center py-1">
          <canvas
            ref={previewRef}
            style={{
              width: PREVIEW_W,
              height: PREVIEW_H,
              display: "block",
              borderRadius: 4,
              imageRendering: "auto",
            }}
          />
          {backgroundMode === "map" && !isMapReady && (
            <span
              className="pointer-events-none absolute text-xs text-muted-foreground"
              style={{ marginTop: PREVIEW_H / 2 - 8 }}
            >
              Rendering map…
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Background</span>
          <div className="flex gap-1.5">
            {bgModes.map(({ key, label }) => {
              if (key === "photo" && trackPhotos.length === 0) return null
              return (
                <Button
                  key={key}
                  size="xs"
                  variant={backgroundMode === key ? "default" : "outline"}
                  onClick={() => setBackgroundMode(key)}
                >
                  {label}
                </Button>
              )
            })}
          </div>
        </div>

        {backgroundMode === "photo" && trackPhotos.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Photo</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSelectedPhotoIndex((i) => i - 1)}
                disabled={!hasPrev}
                aria-label="Previous photo"
              >
                <CaretLeftIcon />
              </Button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums">
                {selectedPhotoIndex + 1} / {trackPhotos.length}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSelectedPhotoIndex((i) => i + 1)}
                disabled={!hasNext}
                aria-label="Next photo"
              >
                <CaretRightIcon />
              </Button>
            </div>
          </div>
        )}

        {backgroundMode !== "dark" && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Blur</span>
            <div className="flex flex-wrap gap-1.5">
              {BLUR_PRESETS.map((v) => (
                <Button
                  key={v}
                  size="xs"
                  variant={blurAmount === v ? "default" : "outline"}
                  onClick={() => setBlurAmount(v)}
                >
                  {v}px
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            Stats{" "}
            <span className="opacity-50">
              ({enabledStats.length} / {MAX_SELECTED})
            </span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableStats.map((key) => {
              const selected = enabledStats.includes(key)
              return (
                <Button
                  key={key}
                  size="xs"
                  variant={selected ? "default" : "outline"}
                  onClick={() => toggleStat(key)}
                  aria-pressed={selected}
                >
                  {STAT_DEFS[key].label}
                </Button>
              )
            })}
          </div>
        </div>

        {actionError && (
          <p className="text-xs text-destructive">{actionError}</p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isExporting || isCopying}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={isCopying || isExporting}
          >
            <CopyIcon weight="bold" />
            {isCopied ? "Copied!" : isCopying ? "Copying…" : "Copy PNG"}
          </Button>
          <Button size="sm" onClick={handleExport} disabled={isExporting || isCopying}>
            <DownloadSimpleIcon weight="bold" />
            {isExporting ? "Exporting…" : "Download PNG"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
