import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEventHandler,
  type RefCallback,
} from "react"

interface DraggableOptions {
  /** `Infinity` aligns with the far edge; a negative value offsets from it. */
  x: number
  /** `Infinity` aligns with the far edge; a negative value offsets from it. */
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

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y
}

export function formatDraggableTransform({ x, y }: Position): string {
  return `translate3d(${x}px, ${y}px, 0)`
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
      x:
        x === Infinity
          ? viewportWidth - width - padding
          : x < 0
            ? viewportWidth - width + x
            : x,
      y:
        y === Infinity
          ? viewportHeight - height - padding
          : y < 0
            ? viewportHeight - height + y
            : y,
    },
    { width, height, viewportWidth, viewportHeight, padding }
  )
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, textarea, select, [role='button'], [contenteditable='true']"
      )
    )
  )
}

export function useDraggable({ x, y, padding = 0 }: DraggableOptions) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const originRef = useRef({ x: 0, y: 0 })
  const positionRef = useRef<Position>({ x: 0, y: 0 })
  const pendingPositionRef = useRef<Position>({ x: 0, y: 0 })
  const boundsRef = useRef<DraggableBounds | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const activeHandleRef = useRef<HTMLElement | null>(null)
  const previousTouchActionRef = useRef("")
  const initializedRef = useRef(false)
  const optionsRef = useRef({ x, y, padding })
  optionsRef.current = { x, y, padding }

  const setElement = useCallback<RefCallback<HTMLDivElement>>((element) => {
    elementRef.current = element
  }, [])

  const measureBounds = useCallback((): DraggableBounds | null => {
    const element = elementRef.current
    if (!element) return null
    const { width, height } = element.getBoundingClientRect()
    const nextBounds = {
      width,
      height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      padding: optionsRef.current.padding,
    }
    boundsRef.current = nextBounds
    return nextBounds
  }, [])

  const writePosition = useCallback((position: Position) => {
    const element = elementRef.current
    if (!element) return
    positionRef.current = position
    pendingPositionRef.current = position
    element.style.transform = formatDraggableTransform(position)
  }, [])

  const applyPendingPosition = useCallback(() => {
    animationFrameRef.current = null
    const element = elementRef.current
    const bounds = boundsRef.current
    if (!element || !bounds) return
    const nextPosition = constrainDraggablePosition(
      pendingPositionRef.current,
      bounds
    )
    if (samePosition(positionRef.current, nextPosition)) return
    positionRef.current = nextPosition
    element.style.transform = formatDraggableTransform(nextPosition)
  }, [])

  const schedulePositionWrite = useCallback(() => {
    if (animationFrameRef.current !== null) return
    animationFrameRef.current =
      window.requestAnimationFrame(applyPendingPosition)
  }, [applyPendingPosition])

  const releasePointer = useCallback(() => {
    const pointerId = pointerIdRef.current
    const handle = activeHandleRef.current
    if (pointerId !== null && handle?.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId)
    }
    if (handle) handle.style.touchAction = previousTouchActionRef.current
    activeHandleRef.current = null
    pointerIdRef.current = null
    isDraggingRef.current = false
  }, [])

  const flushPosition = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    applyPendingPosition()
  }, [applyPendingPosition])

  const reclampPosition = useCallback(() => {
    const bounds = measureBounds()
    if (!bounds) return
    const nextPosition = constrainDraggablePosition(positionRef.current, bounds)
    if (samePosition(positionRef.current, nextPosition)) return
    writePosition(nextPosition)
  }, [measureBounds, writePosition])

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (
        isDraggingRef.current ||
        !event.isPrimary ||
        (event.button !== 0 && event.button !== -1) ||
        isInteractiveTarget(event.target)
      ) {
        return
      }

      const bounds = measureBounds()
      if (!bounds) return
      const currentPosition = constrainDraggablePosition(
        positionRef.current,
        bounds
      )
      if (!samePosition(positionRef.current, currentPosition)) {
        writePosition(currentPosition)
      }

      const handle = event.currentTarget
      isDraggingRef.current = true
      pointerIdRef.current = event.pointerId
      activeHandleRef.current = handle
      previousTouchActionRef.current = handle.style.touchAction
      handle.style.touchAction = "none"
      originRef.current = {
        x: event.clientX - currentPosition.x,
        y: event.clientY - currentPosition.y,
      }
      handle.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    },
    [measureBounds, writePosition]
  )

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (!isDraggingRef.current || pointerIdRef.current !== event.pointerId) {
        return
      }

      pendingPositionRef.current = {
        x: event.clientX - originRef.current.x,
        y: event.clientY - originRef.current.y,
      }
      schedulePositionWrite()
      event.preventDefault()
    },
    [schedulePositionWrite]
  )

  const finishPointer = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return
      pendingPositionRef.current = {
        x: event.clientX - originRef.current.x,
        y: event.clientY - originRef.current.y,
      }
      flushPosition()
      releasePointer()
      event.preventDefault()
      event.stopPropagation()
    },
    [flushPosition, releasePointer]
  )

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return

    if (!initializedRef.current) {
      const initialBounds = measureBounds()
      if (!initialBounds) return
      const initialPosition = getInitialDraggablePosition(
        { x: optionsRef.current.x, y: optionsRef.current.y },
        initialBounds
      )
      initializedRef.current = true
      writePosition(initialPosition)
    } else {
      measureBounds()
    }

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reclampPosition)
    resizeObserver?.observe(element)
    window.addEventListener("resize", reclampPosition)

    return () => {
      flushPosition()
      releasePointer()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", reclampPosition)
    }
  }, [
    flushPosition,
    measureBounds,
    reclampPosition,
    releasePointer,
    writePosition,
  ])

  return {
    style: {
      left: 0,
      top: 0,
    } satisfies CSSProperties,
    ref: setElement,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
  }
}
