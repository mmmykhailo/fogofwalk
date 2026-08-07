import { useRef, useState } from "react"
import {
  XIcon,
  ShareNetworkIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import { useCopyToClipboard } from "~/lib/useCopyToClipboard"
import type { ParsedTrack, TrackLap, TrackStats } from "~/types/tracks"
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "~/components/ui/card"
import { Button } from "~/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer"
import { useDraggable } from "~/lib/useDraggable"
import { useIsMobile } from "~/lib/useIsMobile"
import { computeCompositeStats } from "~/lib/shareCard"
import { DeleteTrackDialog } from "./DeleteTrackDialog"
import { MultiTrackStats } from "./MultiTrackStats"
import { SingleTrackStats } from "./SingleTrackStats"

interface TrackStatsPanelProps {
  tracks: ParsedTrack[]
  onClose: () => void
  onRemoveTrack?: (id: string) => void
  onShare?: () => void
  onDelete?: () => void
  /** The selected lap, already validated by the parent. Null = whole track. */
  activeLap?: TrackLap | null
  onLapSelect?: (lapNumber: number | null) => void
}

const EMPTY_STATS: TrackStats = {
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
}

/**
 * Chrome around the stats: a vaul Drawer on mobile, a draggable Card on
 * desktop. The numbers themselves live in SingleTrackStats / MultiTrackStats.
 */
export function TrackStatsPanel({
  tracks,
  onClose,
  onRemoveTrack,
  onShare,
  onDelete,
  activeLap = null,
  onLapSelect,
}: TrackStatsPanelProps) {
  const isMulti = tracks.length > 1
  const track = tracks[0]
  // stats may be absent on tracks loaded before this field was added (HMR / future compat)
  const stats = activeLap ? activeLap.stats : (track?.stats ?? EMPTY_STATS)
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

  const statsContent =
    isMulti && composite ? (
      <MultiTrackStats
        tracks={tracks}
        composite={composite}
        onRemoveTrack={onRemoveTrack}
      />
    ) : (
      <SingleTrackStats
        stats={stats}
        laps={track?.laps}
        activeLap={activeLap}
        onLapSelect={onLapSelect}
      />
    )

  const panelTitle = isMulti ? `${tracks.length} activities` : track.name

  const titleContent = (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{panelTitle}</span>
      {activeLap && (
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          Lap {activeLap.number}
        </span>
      )}
    </span>
  )

  const deleteDialog = onDelete && !isMulti && (
    <DeleteTrackDialog
      open={isDeleteOpen}
      onOpenChange={setIsDeleteOpen}
      trackName={track.name}
      onConfirm={onDelete}
    />
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
                <DrawerTitle className="min-w-0 flex-1">
                  {titleContent}
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
          <CardTitle className="min-w-0">{titleContent}</CardTitle>
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
