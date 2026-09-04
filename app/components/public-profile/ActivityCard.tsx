import type { PublicActivityMeta } from "~shared/api"
import { Menu } from "@base-ui/react/menu"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { ReactNode } from "react"
import { updateActivityVisibility } from "~/lib/server/activityVisibility"
import { ActivityCardFrame } from "~/components/activity/ActivityCardFrame"
import type { ActivityCardData } from "~/components/activity/ActivityCardFrame"

export type { ActivityCardData }

interface ActivityCardProps {
  activity: PublicActivityMeta | ActivityCardData
  activityId?: string
  /** Local map destination. Public-profile activities intentionally have none. */
  activityHref?: string
  selectionControl?: ReactNode
  settingsControls?: ReactNode
  isOwner?: boolean
  onHidden?: (contentHash: string) => void
}

export function ActivityCard({
  activity,
  activityId,
  activityHref,
  selectionControl,
  settingsControls,
  isOwner = false,
  onHidden,
}: ActivityCardProps) {
  const [isHiding, setIsHiding] = useState(false)
  const lastDot = activity.name.lastIndexOf(".")
  const activityName =
    lastDot > 0 ? activity.name.slice(0, lastDot) : activity.name
  const contentHash = "contentHash" in activity ? activity.contentHash : null

  async function handleHide() {
    if (contentHash == null) return

    setIsHiding(true)
    try {
      await updateActivityVisibility(contentHash, false)
      onHidden?.(contentHash)
    } catch (err) {
      console.warn("[public-profile] failed to hide activity:", err)
    } finally {
      setIsHiding(false)
    }
  }

  const actions = isOwner && contentHash != null && (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Activity actions for ${activityName}`}
        className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={isHiding}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4}>
          <Menu.Popup className="z-50 min-w-40 border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
            <Menu.Item
              className="flex w-full cursor-pointer items-center px-2 py-1.5 text-sm outline-none hover:bg-muted data-[highlighted]:bg-muted"
              disabled={isHiding}
              onClick={handleHide}
            >
              Hide from profile
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )

  return (
    <ActivityCardFrame
      activity={activity}
      activityId={activityId}
      activityHref={activityHref}
      selectionControl={selectionControl}
      settingsControls={settingsControls}
      actions={actions}
    />
  )
}
