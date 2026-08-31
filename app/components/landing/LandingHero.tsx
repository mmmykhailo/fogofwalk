import {
  ArrowRightIcon,
  CompassIcon,
  FileArrowUpIcon,
} from "@phosphor-icons/react"
import { buttonVariants } from "~/components/ui/button"
import { TransitionLink } from "~/components/TransitionLink"
import { cn } from "~/lib/utils"

export function LandingHero() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
        <div className="flex flex-col items-start">
          <p className="mb-5 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            <CompassIcon size={16} weight="duotone" />
            Your world, revealed
          </p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl">
            Make every route count.
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
            Turn the walks, rides, and runs you have already recorded into a
            living map. Lift the fog from every place you have explored and find
            the blank spaces calling you next.
          </p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <TransitionLink
              to="/"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "w-full sm:w-auto"
              )}
            >
              Start exploring
              <ArrowRightIcon size={16} />
            </TransitionLink>
            <TransitionLink
              to="/help#file-formats"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-full sm:w-auto"
              )}
            >
              <FileArrowUpIcon size={16} />
              Supports GPX and FIT
            </TransitionLink>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free to use. Account is optional.
          </p>
        </div>
        <div className="relative">
          <div className="absolute -inset-3 -z-10 bg-chart-1/10 blur-3xl" />
          <img
            src="/landing-hero-banner.png"
            alt="A dark map with a route clearing the fog"
            className="aspect-[1.7/1] w-full border border-foreground/15 object-cover shadow-2xl shadow-foreground/10"
          />
          <div className="absolute -bottom-4 left-4 border border-border bg-background px-3 py-2 text-xs shadow-lg sm:left-6">
            <span className="mr-2 inline-block size-2 bg-chart-2" />
            Your routes clear the way
          </div>
        </div>
      </div>
    </section>
  )
}
