interface SavedPointTooltipProps {
  name: string
}

export function SavedPointTooltip({ name }: SavedPointTooltipProps) {
  return (
    <div className="pointer-events-none rounded-md bg-popover px-3 py-0 text-sm font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10">
      {name}
    </div>
  )
}
