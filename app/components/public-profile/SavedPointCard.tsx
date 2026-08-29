import { MapPinIcon } from "@phosphor-icons/react"
import { AppLink } from "~/components/AppLink"
import { SAVED_POINT_COLORS, type SavedPointColor } from "~shared/saved-points"
import type { SavedPoint } from "~shared/saved-points"

interface SavedPointCardProps {
  point: SavedPoint
  /** Only an owner may open their point in the editable map view. */
  isOwner?: boolean
}

function formatCoordinates(point: SavedPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

function formatColorName(color: SavedPointColor): string {
  return color[0].toUpperCase() + color.slice(1)
}

export function SavedPointCard({
  point,
  isOwner = false,
}: SavedPointCardProps) {
  const color = SAVED_POINT_COLORS[point.color as SavedPointColor]
  const colorName = formatColorName(point.color as SavedPointColor)
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-label={`${colorName} saved point`}
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          <MapPinIcon aria-hidden="true" size={20} weight="fill" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-sm font-medium">{point.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatCoordinates(point)}
          </p>
        </div>
      </div>
      {point.description && (
        <p className="text-xs/relaxed text-muted-foreground">
          {point.description}
        </p>
      )}
      <p className="sr-only">Colour: {colorName}</p>
    </>
  )

  return (
    <div className="min-w-0 rounded-none bg-card text-card-foreground ring-1 ring-foreground/10">
      {isOwner ? (
        <AppLink
          to={`/?savedPoint=${encodeURIComponent(point.id)}`}
          className="flex h-full flex-col gap-3 rounded-none p-4 transition-colors outline-none hover:bg-muted hover:decoration-0 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${point.name} on the map to edit`}
        >
          {content}
        </AppLink>
      ) : (
        <div className="flex flex-col gap-3 p-4">{content}</div>
      )}
    </div>
  )
}
