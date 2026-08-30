import { useRef, useState } from "react"
import { XIcon } from "@phosphor-icons/react"
import { DraggableDialog } from "~/components/DraggableDialog"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer"
import { useIsMobile } from "~/lib/useIsMobile"
import type { SavedPoint } from "~shared/saved-points"

interface DraggableSavedPointViewDialogProps {
  point: SavedPoint
  onClose: () => void
}

function SavedPointDetails({ point }: { point: SavedPoint }) {
  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-muted-foreground">Coordinates</dt>
        <dd className="mt-1 font-medium tabular-nums">
          {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
        </dd>
      </div>
      {point.description && (
        <div>
          <dt className="text-muted-foreground">Description</dt>
          <dd className="mt-1 whitespace-pre-wrap">{point.description}</dd>
        </div>
      )}
    </dl>
  )
}

/** Read-only saved-point details: a mobile drawer and draggable desktop card. */
export function DraggableSavedPointViewDialog({
  point,
  onClose,
}: DraggableSavedPointViewDialogProps) {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)

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
            Saved point details
          </DrawerDescription>
          <DrawerHeader>
            <DrawerTitle>{point.name}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <SavedPointDetails point={point} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DraggableDialog className="z-20 w-96 max-w-[calc(100vw-1.5rem)]">
      {({ onMouseDown, onTouchStart }) => (
        <Card className="bg-background/80 backdrop-blur-md">
          <CardHeader
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            className="cursor-grab select-none active:cursor-grabbing"
          >
            <CardTitle>{point.name}</CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleDismiss}
                aria-label="Close"
              >
                <XIcon weight="bold" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <SavedPointDetails point={point} />
          </CardContent>
        </Card>
      )}
    </DraggableDialog>
  )
}
