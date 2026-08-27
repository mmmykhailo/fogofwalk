import { useRef, useState } from "react"
import {
  XIcon,
  ShareNetworkIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import { useCopyToClipboard } from "~/lib/useCopyToClipboard"
import type {
  ParsedActivity,
  ActivityLap,
  ActivityStats,
} from "~/types/activities"
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
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer"
import { useDraggable } from "~/lib/useDraggable"
import { useIsMobile } from "~/lib/useIsMobile"
import { computeCompositeStats } from "~/lib/shareCard"
import { DeleteActivityDialog } from "./DeleteActivityDialog"
import { MultiActivityStats } from "./MultiActivityStats"
import { SingleActivityStats } from "./SingleActivityStats"

interface ActivityStatsPanelProps {
  activities: ParsedActivity[]
  onClose: () => void
  onRemoveActivity?: (id: string) => void
  onShare?: () => void
  /** Receives whether the server copy should go too. */
  onDelete?: (alsoOnServer: boolean) => void
  /** The selected lap, already validated by the parent. Null = whole activity. */
  activeLap?: ActivityLap | null
  onLapSelect?: (lapNumber: number | null) => void
  /** Called when the user changes the single activity's public/private setting. */
  onVisibilityChange?: (isPublic: boolean) => void
  isVisibilityLoading?: boolean
}

const EMPTY_STATS: ActivityStats = {
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
 * desktop. The numbers themselves live in SingleActivityStats / MultiActivityStats.
 */
export function ActivityStatsPanel({
  activities,
  onClose,
  onRemoveActivity,
  onShare,
  onDelete,
  activeLap = null,
  onLapSelect,
  onVisibilityChange,
  isVisibilityLoading,
}: ActivityStatsPanelProps) {
  const isMulti = activities.length > 1
  const activity = activities[0]
  // stats may be absent on activities loaded before this field was added (HMR / future compat)
  const stats = activeLap ? activeLap.stats : (activity?.stats ?? EMPTY_STATS)
  const composite = isMulti ? computeCompositeStats(activities) : null

  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isNameCopied, copyName] = useCopyToClipboard()
  // Local open state so the exit animation plays before the parent unmounts
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)
  const isMobile = useIsMobile()
  const { style, ref, onMouseDown, onTouchStart } = useDraggable({
    x: Infinity,
    y: 0,
    padding: 12,
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
          onClick={() => copyName(activity.name)}
          aria-label="Copy activity name"
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
          aria-label="Delete activity"
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
      <MultiActivityStats
        activities={activities}
        composite={composite}
        onRemoveActivity={onRemoveActivity}
      />
    ) : (
      <SingleActivityStats
        stats={stats}
        laps={activity?.laps}
        activeLap={activeLap}
        onLapSelect={onLapSelect}
        isPublic={activity?.isPublic}
        onVisibilityChange={onVisibilityChange}
        isVisibilityLoading={isVisibilityLoading}
      />
    )

  // No lap indicator here — the LapSelector trigger right below already reads
  // "Lap 3", so repeating it in the title was redundant.
  const panelTitle = isMulti ? `${activities.length} activities` : activity.name

  const deleteDialog = onDelete && !isMulti && (
    <DeleteActivityDialog
      open={isDeleteOpen}
      onOpenChange={setIsDeleteOpen}
      activityName={activity.name}
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
            <DrawerDescription className="sr-only">
              Activity statistics
            </DrawerDescription>
            <DrawerHeader>
              <div className="flex items-center justify-between gap-2">
                <DrawerTitle className="min-w-0 flex-1 truncate text-left">
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
    <div ref={ref} className="absolute z-10 w-80" style={style}>
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
