import type { EarnedAchievement } from "~/lib/achievements"
import { AchievementIcon } from "~/components/public-profile/AchievementIcon"

interface AchievementCardProps {
  achievement: EarnedAchievement
}

function formatActivityTypes(
  activityTypes: EarnedAchievement["definition"]["activityTypes"]
): string | null {
  if (!activityTypes?.length) return null

  const labels = activityTypes.map(
    (activityType) => activityType[0].toUpperCase() + activityType.slice(1)
  )
  return labels.length === 1 ? labels[0] : labels.join(" or ")
}

export function AchievementCard({ achievement }: AchievementCardProps) {
  const { definition, earnedAtMs } = achievement
  const activityTypes = formatActivityTypes(definition.activityTypes)

  return (
    <article className="flex min-w-0 gap-3 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <div
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center bg-primary/10 text-primary"
      >
        <AchievementIcon achievement={achievement} />
      </div>
      <div className="min-w-0">
        <h3 className="font-heading text-sm font-medium">{definition.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {definition.description}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {activityTypes && <span>{activityTypes} · </span>}
          {earnedAtMs == null ? (
            "Earned on an undated activity"
          ) : (
            <>
              Earned{" "}
              <time dateTime={new Date(earnedAtMs).toISOString()}>
                {new Date(earnedAtMs).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </>
          )}
        </p>
      </div>
    </article>
  )
}
