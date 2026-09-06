import type { PublicActivityMeta } from "~shared/api"
import type { ReactNode } from "react"
import { ActivityCardLayout } from "~/components/activity/ActivityCardLayout"
import type { ActivityCardData } from "~/components/activity/ActivityCardLayout"

export type { ActivityCardData }

interface PublicActivityCardProps {
  activity: PublicActivityMeta | ActivityCardData
  activityId?: string
  /** Local map destination. Public-profile activities intentionally have none. */
  activityHref?: string
  selectionControl?: ReactNode
  settingsControls?: ReactNode
  actions?: ReactNode
}

export function PublicActivityCard({
  activity,
  activityId,
  activityHref,
  selectionControl,
  settingsControls,
  actions,
}: PublicActivityCardProps) {
  return (
    <ActivityCardLayout
      activity={activity}
      activityId={
        activityId ??
        ("contentHash" in activity ? activity.contentHash : undefined)
      }
      activityHref={activityHref}
      selectionControl={selectionControl}
      settingsControls={settingsControls}
      actions={actions}
    />
  )
}
