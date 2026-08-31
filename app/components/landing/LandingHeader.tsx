import { ListIcon } from "@phosphor-icons/react"
import { buttonVariants } from "~/components/ui/button"
import { TransitionLink } from "~/components/TransitionLink"
import { cn } from "~/lib/utils"

export function LandingHeader() {
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"
      >
        <TransitionLink
          to="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          Fog of Walk
        </TransitionLink>
      </nav>
    </header>
  )
}
