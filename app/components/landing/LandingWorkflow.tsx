import { CheckIcon } from "@phosphor-icons/react"
import { Grid } from "~/components/Grid"

const steps = [
  [
    "Bring your history",
    "Import GPX or FIT files from your watch or fitness app.",
  ],
  [
    "Watch the fog lift",
    "Your routes become a personal record of everywhere you have gone.",
  ],
  [
    "Choose the next gap",
    "Use the blank patches on the map as your next small adventure.",
  ],
] as const

export function LandingWorkflow() {
  return (
    <section className="border-b border-border bg-secondary/45">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Grid columns={{ base: 1, lg: 2 }} className="items-start">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Start in minutes
            </p>
            <h2 className="mt-4 max-w-md text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Your past adventures are a great place to begin.
            </h2>
          </div>
          <ol className="space-y-5">
            {steps.map(([title, detail], index) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-7 shrink-0 place-items-center bg-foreground text-xs font-semibold text-background">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Grid>
      </div>
    </section>
  )
}
