import { useRef, useState } from "react"
import { XIcon } from "@phosphor-icons/react"
import { DraggableDialog } from "~/components/DraggableDialog"
import { SavedPointForm } from "~/components/SavedPointForm"
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

interface DraggableSavedPointDialogProps {
  point: SavedPoint | null
  coordinate: [number, number] | null
  onClose: () => void
  onSave: (point: SavedPoint) => void
  onDelete?: (id: string) => void
}

/** Saved-point editor: a mobile drawer and a draggable desktop card. */
export function DraggableSavedPointDialog({
  point,
  coordinate,
  onClose,
  onSave,
  onDelete,
}: DraggableSavedPointDialogProps) {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = useState(true)
  const isDismissingRef = useRef(false)
  const title = point ? "Edit saved point" : "Save point"
  // SavedPointForm owns the uncontrolled field defaults and form-specific state.
  // Remount it when switching targets so an open editor never retains values
  // from the previously selected point (or from an edit when creating one).
  const formKey = point?.id ?? coordinate?.join(",") ?? "new"

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

  const form = (
    <SavedPointForm
      key={formKey}
      point={point}
      coordinate={coordinate}
      onCancel={handleDismiss}
      onSave={onSave}
      onDelete={onDelete}
    />
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
          <DrawerDescription className="sr-only">{title}</DrawerDescription>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">{form}</div>
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
            <CardTitle>{title}</CardTitle>
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
          <CardContent>{form}</CardContent>
        </Card>
      )}
    </DraggableDialog>
  )
}
