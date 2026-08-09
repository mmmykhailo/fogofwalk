import type { Route } from "./+types/help"
import { PageShell } from "~/components/PageShell"
import { AppLink } from "~/components/AppLink"
import { WhatIsItSection } from "~/components/help/WhatIsItSection"
import { WorkflowSection } from "~/components/help/WorkflowSection"
import { FileFormatsSection } from "~/components/help/FileFormatsSection"
import { PhotosSection } from "~/components/help/PhotosSection"
import { TrackStatsSection } from "~/components/help/TrackStatsSection"
import { StatisticsSection } from "~/components/help/StatisticsSection"
import { SharingSection } from "~/components/help/SharingSection"
import { MapControlsSection } from "~/components/help/MapControlsSection"
import { InstallSection } from "~/components/help/InstallSection"
import { SyncSection } from "~/components/help/SyncSection"
import { RemovingSection } from "~/components/help/RemovingSection"
import { TroubleshootingSection } from "~/components/help/TroubleshootingSection"

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

/**
 * Rendered in order, separated by a rule — array order is the reading order.
 * Keys are explicit rather than derived from `Section.name`, which minification
 * is free to rewrite.
 */
const SECTIONS: { id: string; Section: () => React.ReactElement }[] = [
  { id: "what", Section: WhatIsItSection },
  { id: "workflow", Section: WorkflowSection },
  { id: "formats", Section: FileFormatsSection },
  { id: "photos", Section: PhotosSection },
  { id: "track-stats", Section: TrackStatsSection },
  { id: "statistics", Section: StatisticsSection },
  { id: "sharing", Section: SharingSection },
  { id: "map-controls", Section: MapControlsSection },
  { id: "install", Section: InstallSection },
  { id: "sync", Section: SyncSection },
  { id: "removing", Section: RemovingSection },
  { id: "troubleshooting", Section: TroubleshootingSection },
]

export default function HelpPage() {
  return (
    <PageShell title="How Fog of Walk works">
      {SECTIONS.map(({ id, Section }, i) => (
        <div key={id}>
          {i > 0 && <hr className="mb-10 border-border" />}
          <Section />
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
