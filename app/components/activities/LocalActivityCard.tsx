import { memo, useCallback, useMemo } from "react"
import { ActivityCardFrame } from "~/components/activity/ActivityCardFrame"
import { ActivitySettingsControls } from "~/components/activities/ActivitySettingsControls"
import { Checkbox } from "~/components/ui/checkbox"
import type { ParsedActivity } from "~/types/activities"

interface LocalActivityCardProps {
  activity: ParsedActivity
  isSelected: boolean
  showActivitySettings: boolean
  canEditPublicity: boolean
  publicityDisabledDescription: string
  onSelectionChange: (activityId: string, isSelected: boolean) => void
}

export const LocalActivityCard = memo(function LocalActivityCard({
  activity,
  isSelected,
  showActivitySettings,
  canEditPublicity,
  publicityDisabledDescription,
  onSelectionChange,
}: LocalActivityCardProps) {
  const handleSelectionChange = useCallback(
    (checked: boolean) => onSelectionChange(activity.id, checked),
    [activity.id, onSelectionChange]
  )
  const cardData = useMemo(
    () => ({
      name: activity.name,
      startedAtMs: activity.startedAtMs,
      distanceKm: activity.stats.distanceKm,
      durationMs: activity.stats.durationMs,
      elevationGainM: activity.stats.elevationGainM,
      avgMovingSpeedKmh: activity.stats.avgMovingSpeedKmh,
    }),
    [activity]
  )
  const selectionControl = useMemo(
    () => (
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleSelectionChange}
          aria-label={`Select activity ${activity.name}`}
        />
      </span>
    ),
    [activity.name, handleSelectionChange, isSelected]
  )
  const settingsControls = showActivitySettings ? (
    <ActivitySettingsControls
      activity={activity}
      canEditPublicity={canEditPublicity}
      publicityDisabledDescription={publicityDisabledDescription}
    />
  ) : undefined

  return (
    <ActivityCardFrame
      activity={cardData}
      activityId={activity.id}
      activityHref={`/map?activity=${activity.id}`}
      selectionControl={selectionControl}
      settingsControls={settingsControls}
    />
  )
})
