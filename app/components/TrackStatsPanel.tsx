import { useRef, useState } from "react"
import {
  XIcon,
  ShareNetworkIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import { useCopyToClipboard } from "~/lib/useCopyToClipboard"
import type { ParsedTrack } from "~/types/tracks"
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "~/components/ui/card"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer"
import { ElevationChart } from "~/components/ElevationChart"
import { useDraggable } from "~/lib/useDraggable"
import { useIsMobile } from "~/lib/useIsMobile"
import { computeCompositeStats } from "~/lib/shareCard"

interface TrackStatsPanelProps {
  tracks: ParsedTrack[]
  onClose: () => void
  onRemoveTrack?: (id: string) => void
  onShare?: () => void
  onDelete?: () => void
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatPace(minPerKm: number): string {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, "0")}/km`
}

function formatSpeed(kmh: number): string {
  return `${kmh.toFixed(1)} km/h`
}

function formatDistance(km: number): string {
  return `${km.toFixed(2)} km`
}

function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}

interface StatRowProps {
  label: string
  value: string
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </>
  )
}

const EMPTY_STATS = {
  distanceKm: 0,
  uniqueDistanceKm: 0,
  elevationGainM: 0,
  elevationLossM: 0,
  hasElevation: false,
  durationMs: null,
  movingTimeMs: null,
  avgPaceMinPerKm: null,
  avgMovingPaceMinPerKm: null,
  avgSpeedKmh: null,
  avgMovingSpeedKmh: null,
  elevationProfile: [],
} as const


export function TrackStatsPanel({
  tracks,
  onClose,
  onRemoveTrack,
  onShare,
  onDelete,
}: TrackStatsPanelProps) {
  const isMulti = tracks.length > 1
  const track = tracks[0]
  // stats may be absent on tracks loaded before this field was added (HMR / future compat)
  const stats = track?.stats ?? EMPTY_STATS
  const uniqueKm = track?.stats.uniqueDistanceKm
  const composite = isMulti ? computeCompositeStats(tracks) : null

  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isNameCopied, copyName] = useCopyToClipboard()
  // Local open state so the exit animation plays before the parent unmounts
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)
  const isMobile = useIsMobile()
  const { style, onMouseDown, onTouchStart } = useDraggable({
    x: typeof window !== "undefined" ? window.innerWidth - 336 : 0,
    y: 16,
  })

  // On mobile: set open=false so the sheet exit animation plays, then call onClose
  // On desktop: close immediately (no sheet, no animation needed)
  function handleDismiss() {
    if (isDismissingRef.current) return
    isDismissingRef.current = true
    if (isMobile) {
      setIsOpen(false)
      setTimeout(onClose, 200)
    } else {
      onClose()
    }
  }

  const actionButtons = (
    <>
      {!isMulti && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => copyName(track.name)}
          aria-label="Copy track name"
        >
          {isNameCopied ? (
            <CheckIcon weight="bold" />
          ) : (
            <CopyIcon weight="duotone" />
          )}
        </Button>
      )}
      {onShare && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onShare}
          aria-label="Share"
        >
          <ShareNetworkIcon weight="duotone" />
        </Button>
      )}
      {onDelete && !isMulti && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsDeleteOpen(true)}
          aria-label="Delete track"
        >
          <TrashIcon weight="duotone" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleDismiss}
        aria-label="Close"
        className="hidden sm:inline-flex"
      >
        <XIcon weight="bold" />
      </Button>
    </>
  )

  const singleStatsContent = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <StatRow label="Distance" value={formatDistance(stats.distanceKm)} />
        {uniqueKm != null && stats.distanceKm > 0 && (
          <StatRow
            label="Unique distance"
            value={`${formatDistance(uniqueKm)} (${Math.round((uniqueKm / stats.distanceKm) * 100)}%)`}
          />
        )}
        {stats.durationMs != null && (
          <StatRow label="Duration" value={formatDuration(stats.durationMs)} />
        )}
        {stats.movingTimeMs != null && (
          <StatRow
            label="Moving time"
            value={formatDuration(stats.movingTimeMs)}
          />
        )}
        {stats.avgPaceMinPerKm != null && (
          <StatRow label="Avg pace" value={formatPace(stats.avgPaceMinPerKm)} />
        )}
        {stats.avgMovingPaceMinPerKm != null && (
          <StatRow
            label="Avg moving pace"
            value={formatPace(stats.avgMovingPaceMinPerKm)}
          />
        )}
        {stats.avgSpeedKmh != null && (
          <StatRow label="Avg speed" value={formatSpeed(stats.avgSpeedKmh)} />
        )}
        {stats.avgMovingSpeedKmh != null && (
          <StatRow
            label="Avg moving speed"
            value={formatSpeed(stats.avgMovingSpeedKmh)}
          />
        )}
        {stats.hasElevation && (
          <>
            <StatRow
              label="Elevation ↑"
              value={formatElevation(stats.elevationGainM)}
            />
            <StatRow
              label="Elevation ↓"
              value={formatElevation(stats.elevationLossM)}
            />
          </>
        )}
      </div>
      {stats.hasElevation && stats.elevationProfile.length >= 2 && (
        <ElevationChart profile={stats.elevationProfile} />
      )}
    </div>
  )

  const multiStatsContent = composite && (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        {tracks.map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {t.name}
            </span>
            {onRemoveTrack && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveTrack(t.id)}
                aria-label={`Remove ${t.name}`}
                className="shrink-0 text-muted-foreground/50 hover:text-foreground"
              >
                <XIcon weight="bold" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <StatRow label="Total distance" value={formatDistance(composite.totalDistanceKm)} />
        {composite.totalUniqueKm > 0 && composite.totalDistanceKm > 0 && (
          <StatRow
            label="Unique distance"
            value={`${formatDistance(composite.totalUniqueKm)} (${Math.round((composite.totalUniqueKm / composite.totalDistanceKm) * 100)}%)`}
          />
        )}
        {composite.totalDurationMs != null && (
          <StatRow label="Total duration" value={formatDuration(composite.totalDurationMs)} />
        )}
        {composite.totalMovingTimeMs != null && (
          <StatRow label="Total moving time" value={formatDuration(composite.totalMovingTimeMs)} />
        )}
        {composite.avgPaceMinPerKm != null && (
          <StatRow label="Avg pace" value={formatPace(composite.avgPaceMinPerKm)} />
        )}
        {composite.avgMovingSpeedKmh != null && (
          <StatRow label="Avg moving speed" value={formatSpeed(composite.avgMovingSpeedKmh)} />
        )}
        {composite.hasElevation && (
          <>
            <StatRow label="Elevation ↑" value={formatElevation(composite.totalElevationGainM)} />
            <StatRow label="Elevation ↓" value={formatElevation(composite.totalElevationLossM)} />
          </>
        )}
      </div>
    </div>
  )

  const statsContent = isMulti ? multiStatsContent : singleStatsContent

  const panelTitle = isMulti ? `${tracks.length} activities` : track.name

  const deleteDialog = onDelete && !isMulti && (
    <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this track?</DialogTitle>
          <DialogDescription>
            &ldquo;{track.name}&rdquo; will be removed and the fog map will be
            recalculated. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setIsDeleteOpen(false)
              onDelete()
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (isMobile) {
    return (
      <>
        <Drawer
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) handleDismiss()
          }}
          modal={false}
        >
          <DrawerContent>
            <DrawerHeader>
              <div className="flex items-center justify-between gap-2">
                <DrawerTitle className="truncate">
                  {panelTitle}
                </DrawerTitle>
                <div className="flex shrink-0 items-center">
                  {actionButtons}
                </div>
              </div>
            </DrawerHeader>
            <div className="px-4 pb-6">{statsContent}</div>
          </DrawerContent>
        </Drawer>
        {deleteDialog}
      </>
    )
  }

  return (
    <div className="absolute z-10 w-80" style={style}>
      <Card className="bg-background/80 backdrop-blur-md">
        <CardHeader
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          className="cursor-grab select-none active:cursor-grabbing"
        >
          <CardTitle className="truncate">{panelTitle}</CardTitle>
          <CardAction>{actionButtons}</CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {statsContent}
        </CardContent>
      </Card>
      {deleteDialog}
    </div>
  )
}
