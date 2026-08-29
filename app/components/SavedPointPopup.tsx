interface SavedPointPopupProps {
  name: string
}

export function SavedPointPopup({ name }: SavedPointPopupProps) {
  return (
    <div className="rounded-md bg-popover px-3 py-2 text-sm font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10">
      {name}
    </div>
  )
}
