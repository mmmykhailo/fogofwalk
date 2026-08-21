import { FootprintsIcon } from "@phosphor-icons/react"
import { Link } from "react-router"

export function EmptyTracksState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
      <FootprintsIcon
        size={40}
        className="text-muted-foreground"
        weight="duotone"
      />
      <p className="text-sm text-muted-foreground">
        Import some tracks to see them here.
      </p>
      <Link
        to="/"
        className="mt-1 text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
      >
        Go to map →
      </Link>
    </div>
  )
}
