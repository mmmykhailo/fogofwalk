import { ArrowRightIcon } from "@phosphor-icons/react"
import { buttonVariants } from "~/components/ui/button"
import { TransitionLink } from "~/components/TransitionLink"
import { cn } from "~/lib/utils"

export function LandingFooter() {
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 lg:flex-row lg:items-end lg:py-20">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-background/60 uppercase">
            The next street is waiting
          </p>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Start revealing your world.
          </h2>
        </div>
        <TransitionLink
          to="/map"
          className={cn(
            buttonVariants({ variant: "secondary", size: "lg" }),
            "bg-background text-foreground hover:bg-background/85"
          )}
        >
          Open Fog of Walk
          <ArrowRightIcon size={16} />
        </TransitionLink>
      </div>
      <div className="border-t border-background/15">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-5 text-xs text-background/60 sm:px-6">
          <span>Fog of Walk</span>
          <div className="flex flex-wrap gap-6">
            <TransitionLink to="/privacy" className="hover:text-background">
              Privacy Policy
            </TransitionLink>
            <TransitionLink to="/terms" className="hover:text-background">
              Terms of Service
            </TransitionLink>
          </div>
        </div>
      </div>
    </footer>
  )
}
