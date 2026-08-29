interface SavedPointTooltipProps {
  name: string
  point: { x: number; y: number }
}

export function SavedPointTooltip({ name, point }: SavedPointTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-10 -mt-5 -translate-x-1/2 -translate-y-full rounded-md bg-popover px-3 py-0 text-sm font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: point.x, top: point.y }}
    >
      {name}
    </div>
  )
}
