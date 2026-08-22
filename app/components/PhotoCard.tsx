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
import { useDraggable } from "~/lib/useDraggable"
import { useIsMobile } from "~/lib/useIsMobile"
import type { PhotoGroup } from "~/types/photos"

interface PhotoCardProps {
  group: PhotoGroup | null
  onClose: () => void
}

export function PhotoCard({ group, onClose }: PhotoCardProps) {
  const [idx, setIdx] = useState(0)
  const [isOpen, setIsOpen] = useState(true)
  const [photoAspectRatio, setPhotoAspectRatio] = useState<{
    groupId: string
    value: number
  } | null>(null)
  const isDismissingRef = useRef(false)
  const isMobile = useIsMobile()
  const { style, ref, onMouseDown, onTouchStart } = useDraggable({
    x: Infinity,
    y: 0,
    padding: 12,
  })

  useEffect(() => {
    setIdx(0)
  }, [group?.id])

  // Reset dismiss guard when a new group is shown
  useEffect(() => {
    isDismissingRef.current = false
    setIsOpen(true)
  }, [group?.id])

  useEffect(() => {
    if (!group) return

    let isCancelled = false
    const urls = group.photos.flatMap((photo) =>
      photo.objectUrl ? [photo.objectUrl] : []
    )

    Promise.all(
      urls.map(
        (url) =>
          new Promise<number | null>((resolve) => {
            const image = new Image()
            image.onload = () =>
              resolve(
                image.naturalWidth > 0 && image.naturalHeight > 0
                  ? image.naturalWidth / image.naturalHeight
                  : null
              )
            image.onerror = () => resolve(null)
            image.src = url
          })
      )
    ).then((aspectRatios) => {
      if (isCancelled) return

      setPhotoAspectRatio({
        groupId: group.id,
        value: Math.max(
          ...aspectRatios.filter((ratio): ratio is number => ratio !== null),
          1
        ),
      })
    })

    return () => {
      isCancelled = true
    }
  }, [group?.id])

  if (!group) return null

  const photo = group.photos[idx]
  const count = group.photos.length
  const isPhotoFrameReady = photoAspectRatio?.groupId === group.id

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
            {isPhotoFrameReady && (
              <div
                className="max-h-[55vh] w-full"
                style={{ aspectRatio: photoAspectRatio.value }}
              >
                {photo.objectUrl && (
                  <img
                    src={photo.objectUrl}
                    alt="Photo"
                    className="block size-full object-contain"
                  />
                )}
              </div>
            )}
            {navControls}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div ref={ref} className="absolute z-20 w-80" style={style}>
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
          {isPhotoFrameReady && (
            <div
              className="w-full"
              style={{ aspectRatio: photoAspectRatio.value }}
            >
              {photo.objectUrl && (
                <img
                  src={photo.objectUrl}
                  alt="Photo"
                  className="block size-full object-contain"
                />
              )}
            </div>
          )}
          {navControls}
        </CardContent>
      </Card>
    </div>
  )
}
