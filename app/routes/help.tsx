import type { Route } from "./+types/help"
import { PageShell } from "~/components/PageShell"
import { PageSection } from "~/components/PageSection"
import { AppLink } from "~/components/AppLink"
import { HelpContents } from "~/components/help/HelpContents"
import { HELP_SECTIONS } from "~/components/help/sections"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "How it works — Fog of Walk" },
    {
      name: "description",
      content:
        "Learn how to use Fog of Walk: supported file formats (GPX, FIT), adding photos, track and lifetime statistics, sharing, installing it as an app, optional cross-device sync, and troubleshooting.",
    },
  ]
}

export default function HelpPage() {
  return (
    <PageShell title="How Fog of Walk works">
      <HelpContents />
      <hr className="mb-10 border-border" />

      {HELP_SECTIONS.map(({ id, title, Body }, i) => (
        <div key={id}>
          {i > 0 && <hr className="mb-10 border-border" />}
          <PageSection id={id} title={title}>
            <Body />
          </PageSection>
        </div>
      ))}

      <div className="pt-4 text-center">
        <AppLink to="/" variant="nav">
          Back to map
        </AppLink>
      </div>
    </PageShell>
  )
}
