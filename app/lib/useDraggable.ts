import { useEffect, useRef, useState } from "react"

interface DraggableOptions {
  /** A negative value is measured from the corresponding far edge. */
  x: number
  /** A negative value is measured from the corresponding far edge. */
  y: number
  /** Minimum distance between the draggable element and the viewport edge. */
  padding?: number
}

interface Position {
  x: number
  y: number
}

interface DraggableBounds {
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  padding: number
}

export function constrainDraggablePosition(
  position: Position,
  { width, height, viewportWidth, viewportHeight, padding }: DraggableBounds
): Position {
  const maxX = Math.max(padding, viewportWidth - width - padding)
  const maxY = Math.max(padding, viewportHeight - height - padding)

  return {
    x: Math.min(Math.max(position.x, padding), maxX),
    y: Math.min(Math.max(position.y, padding), maxY),
  }
}

export function getInitialDraggablePosition(
  { x, y }: Pick<DraggableOptions, "x" | "y">,
  { width, height, viewportWidth, viewportHeight, padding }: DraggableBounds
): Position {
  return constrainDraggablePosition(
    {
      x: x < 0 ? viewportWidth - width + x : x,
      y: y < 0 ? viewportHeight - height + y : y,
    },
    { width, height, viewportWidth, viewportHeight, padding }
  )
}

export function useDraggable({ x, y, padding = 0 }: DraggableOptions) {
  const [pos, setPos] = useState<Position>({ x: 0, y: 0 })
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const origin = useRef({ x: 0, y: 0 })
  const posRef = useRef(pos)
  const hasSetInitialPosition = useRef(false)

  const constrainPosition = (position: Position): Position => {
    if (!element) return position

    const { width, height } = element.getBoundingClientRect()
    return constrainDraggablePosition(position, {
      width,
      height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      padding,
    })
  }

  const updatePosition = (position: Position) => {
    const constrainedPosition = constrainPosition(position)
    posRef.current = constrainedPosition
    setPos(constrainedPosition)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    origin.current = {
      x: e.clientX - posRef.current.x,
      y: e.clientY - posRef.current.y,
    }
    e.preventDefault()
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    dragging.current = true
    origin.current = {
      x: touch.clientX - posRef.current.x,
      y: touch.clientY - posRef.current.y,
    }
  }

  useEffect(() => {
    const setInitialPosition = () => {
      if (hasSetInitialPosition.current || !element) return

      const { width, height } = element.getBoundingClientRect()
      hasSetInitialPosition.current = true
      updatePosition(
        getInitialDraggablePosition(
          { x, y },
          {
            width,
            height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            padding,
          }
        )
      )
    }

    setInitialPosition()

    const resize = () => {
      updatePosition(posRef.current)
    }
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      updatePosition({
        x: e.clientX - origin.current.x,
        y: e.clientY - origin.current.y,
      })
    }
    const up = () => {
      dragging.current = false
    }
    const touchMove = (e: TouchEvent) => {
      if (!dragging.current) return
      const touch = e.touches[0]
      updatePosition({
        x: touch.clientX - origin.current.x,
        y: touch.clientY - origin.current.y,
      })
    }
    const touchEnd = () => {
      dragging.current = false
    }

    const resizeObserver = new ResizeObserver(resize)
    if (element) resizeObserver.observe(element)

    window.addEventListener("resize", resize)
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    window.addEventListener("touchmove", touchMove, { passive: true })
    window.addEventListener("touchend", touchEnd)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      window.removeEventListener("touchmove", touchMove)
      window.removeEventListener("touchend", touchEnd)
    }
  }, [element, padding, x, y])

  return {
    style: { left: pos.x, top: pos.y } as React.CSSProperties,
    ref: setElement,
    onMouseDown,
    onTouchStart,
  }
}
