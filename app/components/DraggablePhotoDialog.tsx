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
import type { PhotoGroup } from "~/types/photos"

interface DraggablePhotoDialogProps {
  group: PhotoGroup | null
  onClose: () => void
}

export function DraggablePhotoDialog({
  group,
  onClose,
}: DraggablePhotoDialogProps) {
  const [idx, setIdx] = useState(0)
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    setIdx(0)
  }, [group?.id])

  // Reset dismiss guard when a new group is shown
  useEffect(() => {
    isDismissingRef.current = false
    setIsOpen(true)
  }, [group?.id])

  if (!group) return null

  const photo = group.photos[idx]
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
                {new Date(photo.takenAtMs).toLocaleString()}
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
              {photo.objectUrl && (
                <img
                  src={photo.objectUrl}
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
      {({ onMouseDown, onTouchStart }) => (
        <Card className="overflow-hidden bg-background/80 backdrop-blur-md">
          <CardHeader
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            className="cursor-grab select-none active:cursor-grabbing"
          >
            <CardTitle className="truncate text-xs">
              {new Date(photo.takenAtMs).toLocaleString()}
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
              {photo.objectUrl && (
                <img
                  src={photo.objectUrl}
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
