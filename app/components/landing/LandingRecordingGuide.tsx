import { FileArrowUpIcon, MapPinIcon, PlayIcon } from "@phosphor-icons/react"
import { Grid } from "~/components/Grid"

const steps = [
  {
    icon: PlayIcon,
    title: "Start tracking before you set off",
    detail:
      "On your phone, open Mapy.com, choose Menu, then Start Tracker. Keep the app running while you walk, run, or ride.",
  },
  {
    icon: MapPinIcon,
    title: "Save the finished route",
    detail:
      "When you are done, stop the tracker and save the recording. It will contain the GPS points from your route.",
  },
  {
    icon: FileArrowUpIcon,
    title: "Export and import the GPX file",
    detail:
      "Export the saved recording as a GPX file, then return here and add it to your map. A watch or dedicated GPS device works too.",
  },
] as const

export function LandingRecordingGuide() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            No GPS watch needed
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            How do I record a GPX file?
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
            Your phone is enough. Any GPS-tracking app that can export GPX will
            work;{" "}
            <a
              href="https://mapy.com/"
              className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/70"
              target="_blank"
              rel="noreferrer"
            >
              Mapy.com
            </a>{" "}
            is an easy place to start.
          </p>
        </div>
        <Grid columns={{ base: 1, md: 3 }} className="mt-10">
          {steps.map(({ icon: Icon, title, detail }, index) => (
            <article
              key={title}
              className="border border-border bg-secondary/35 p-5"
            >
              <div className="flex items-center justify-between">
                <Icon size={24} weight="duotone" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-8 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {detail}
              </p>
            </article>
          ))}
        </Grid>
      </div>
    </section>
  )
}
