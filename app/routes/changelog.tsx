import type { Route } from "./+types/changelog"
import changelog from "../../CHANGELOG.md?raw"
import { ChangelogContents } from "~/components/ChangelogContents"
import { PageShell } from "~/components/PageShell"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Changelog — Fog of Walk" },
    {
      name: "description",
      content: "Release notes and notable updates for Fog of Walk.",
    },
  ]
}

export default function ChangelogPage() {
  return (
    <PageShell title="Changelog">
      <ChangelogContents changelog={changelog} />
    </PageShell>
  )
}
