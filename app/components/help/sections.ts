import { WhatIsItSection } from "~/components/help/WhatIsItSection"
import { WorkflowSection } from "~/components/help/WorkflowSection"
import {
  FileFormatsSection,
  FILE_FORMAT_ANCHORS,
} from "~/components/help/FileFormatsSection"
import { PhotosSection } from "~/components/help/PhotosSection"
import { ActivityStatsSection } from "~/components/help/ActivityStatsSection"
import { StatisticsSection } from "~/components/help/StatisticsSection"
import { SharingSection } from "~/components/help/SharingSection"
import { MapControlsSection } from "~/components/help/MapControlsSection"
import { InstallSection } from "~/components/help/InstallSection"
import { SyncSection } from "~/components/help/SyncSection"
import {
  RemovingSection,
  REMOVAL_KINDS,
} from "~/components/help/RemovingSection"
import {
  TroubleshootingSection,
  TROUBLESHOOTING_ITEMS,
} from "~/components/help/TroubleshootingSection"

/** A heading *inside* a section, rendered as a nested contents entry. */
export interface HelpSubsection {
  id: string
  title: string
}

export interface HelpSection {
  /** Anchor id — also the `#fragment` the contents list links to. */
  id: string
  title: string
  /** Renders the section body only; `help.tsx` supplies the heading. */
  Body: () => React.ReactElement
  /** Only for sections with enough internal structure to be worth listing. */
  children?: HelpSubsection[]
}

/**
 * The single source of truth for the help page's sections: array order is the
 * reading order, and both the rendered headings and the contents list are
 * generated from it. Titles deliberately live here rather than inside each
 * component, so a renamed heading can never drift from its contents entry.
 *
 * Nested entries go the other way — the sub-headings are content, so they are
 * owned by the section that renders them and merely *derived* here. Same
 * guarantee, opposite direction.
 */
export const HELP_SECTIONS: HelpSection[] = [
  { id: "what-is-it", title: "What is Fog of Walk?", Body: WhatIsItSection },
  { id: "workflow", title: "Workflow", Body: WorkflowSection },
  {
    id: "file-formats",
    title: "Supported file formats",
    Body: FileFormatsSection,
    children: FILE_FORMAT_ANCHORS,
  },
  { id: "photos", title: "Adding photos", Body: PhotosSection },
  {
    id: "activity-stats",
    title: "Exploring your activities",
    Body: ActivityStatsSection,
  },
  { id: "statistics", title: "Statistics", Body: StatisticsSection },
  { id: "sharing", title: "Sharing an activity", Body: SharingSection },
  { id: "map-controls", title: "Map controls", Body: MapControlsSection },
  { id: "install", title: "Install it as an app", Body: InstallSection },
  {
    id: "sync",
    title: "Syncing across devices (optional)",
    Body: SyncSection,
  },
  {
    id: "removing",
    title: "Removing things",
    Body: RemovingSection,
    children: REMOVAL_KINDS.map(({ id, title }) => ({ id, title })),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    Body: TroubleshootingSection,
    children: TROUBLESHOOTING_ITEMS.map(({ id, q }) => ({ id, title: q })),
  },
]
