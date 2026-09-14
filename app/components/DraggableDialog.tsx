import type { PointerEventHandler, ReactNode } from "react"
import { cn } from "~/lib/utils"
import { useDraggable } from "~/lib/useDraggable"

interface DraggableDialogProps {
  children: (dragHandleProps: DraggableDialogHandleProps) => ReactNode
  className?: string
  /** `Infinity` aligns with the far edge; a negative value offsets from it. */
  x?: number
  /** `Infinity` aligns with the far edge; a negative value offsets from it. */
  y?: number
  /** Minimum distance between the dialog and the viewport edge. */
  padding?: number
}

interface DraggableDialogHandleProps {
  onPointerDownCapture: PointerEventHandler<HTMLDivElement>
  onPointerMoveCapture: PointerEventHandler<HTMLDivElement>
  onPointerUpCapture: PointerEventHandler<HTMLDivElement>
  onPointerCancelCapture: PointerEventHandler<HTMLDivElement>
}

/** A fixed-position desktop dialog with an opt-in draggable handle. */
export function DraggableDialog({
  children,
  className,
  x = Infinity,
  y = 0,
  padding = 12,
}: DraggableDialogProps) {
  const {
    style,
    ref,
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  } = useDraggable({
    x,
    y,
    padding,
  })

  return (
    <div ref={ref} className={cn("absolute", className)} style={style}>
      {children({
        onPointerDownCapture,
        onPointerMoveCapture,
        onPointerUpCapture,
        onPointerCancelCapture,
      })}
    </div>
  )
}
