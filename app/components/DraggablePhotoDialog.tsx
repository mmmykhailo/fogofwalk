import { useEffect, useRef, useState } from "react"
import { XIcon, ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react"
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
import { useIsMobile } from "~/lib/useIsMobile"
import { DraggableDialog } from "~/components/DraggableDialog"
import type { PhotoEntry, PhotoGroup } from "~/types/photos"

interface DraggablePhotoDialogProps {
  group: PhotoGroup | null
  onClose: () => void
  ensurePhotoObjectUrl: (photo: PhotoEntry) => string
}

export function DraggablePhotoDialog({
  group,
  onClose,
  ensurePhotoObjectUrl,
}: DraggablePhotoDialogProps) {
  const [idx, setIdx] = useState(0)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    setIdx(0)
  }, [group?.id])

  const photo = group?.photos[idx]
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null)
      return
    }
    setPhotoUrl(ensurePhotoObjectUrl(photo))
  }, [ensurePhotoObjectUrl, photo])

  // Reset dismiss guard when a new group is shown
  useEffect(() => {
    isDismissingRef.current = false
    setIsOpen(true)
  }, [group?.id])

  if (!group) return null

  const renderedPhotoUrl = photo?.objectUrl ?? photoUrl
  const count = group.photos.length

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

  const navControls = count > 1 && (
    <div className="flex items-center justify-between px-2 py-1.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setIdx((i) => i - 1)}
        disabled={idx === 0}
        className={idx === 0 ? "invisible" : ""}
        aria-label="Previous photo"
      >
        <ArrowLeftIcon weight="bold" />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {idx + 1} / {count}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setIdx((i) => i + 1)}
        disabled={idx === count - 1}
        className={idx === count - 1 ? "invisible" : ""}
        aria-label="Next photo"
      >
        <ArrowRightIcon weight="bold" />
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleDismiss()
        }}
      >
        <DrawerContent>
          <DrawerDescription className="sr-only">
            Photo viewer
          </DrawerDescription>
          <DrawerHeader>
            <div className="flex items-center justify-between gap-2">
              <DrawerTitle className="truncate text-xs">
                {photo ? new Date(photo.takenAtMs).toLocaleString() : ""}
              </DrawerTitle>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleDismiss}
                aria-label="Close"
                className="hidden shrink-0 sm:inline-flex"
              >
                <XIcon weight="bold" />
              </Button>
            </div>
          </DrawerHeader>
          <div className="pb-4">
            <div className="aspect-[4/3] w-full">
              {renderedPhotoUrl && (
                <img
                  src={renderedPhotoUrl}
                  alt="Photo"
                  className="block size-full object-contain"
                />
              )}
            </div>
            {navControls}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DraggableDialog className="z-20 w-80">
      {(dragHandleProps) => (
        <Card className="overflow-hidden bg-background/80 backdrop-blur-md">
          <CardHeader
            {...dragHandleProps}
            className="cursor-grab touch-none select-none active:cursor-grabbing"
          >
            <CardTitle className="truncate text-xs">
              {photo ? new Date(photo.takenAtMs).toLocaleString() : ""}
            </CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onClose}
                aria-label="Close"
                className="hidden sm:inline-flex"
              >
                <XIcon weight="bold" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            <div className="aspect-[4/3] w-full">
              {renderedPhotoUrl && (
                <img
                  src={renderedPhotoUrl}
                  alt="Photo"
                  className="block size-full object-contain"
                />
              )}
            </div>
            {navControls}
          </CardContent>
        </Card>
      )}
    </DraggableDialog>
  )
}
