import type { EarnedAchievement } from "~/lib/achievements"
import type { PublicAchievementPrevalence } from "~shared/api"
import { AchievementIcon } from "~/components/public-profile/AchievementIcon"

interface AchievementCardProps {
  achievement: EarnedAchievement
  achievementPrevalence?: PublicAchievementPrevalence
}

function formatPrevalence(
  achievement: EarnedAchievement,
  prevalence: PublicAchievementPrevalence | undefined
): string | null {
  if (!prevalence || prevalence.eligibleUserCount === 0) return null
  const earned = prevalence.earnedUserCounts[achievement.definition.id] ?? 0
  const percentage = Math.round((earned / prevalence.eligibleUserCount) * 100)
  return `Only ${percentage}% have this`
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

export function AchievementCard({
  achievement,
  achievementPrevalence,
}: AchievementCardProps) {
  const { definition, earnedAtMs } = achievement
  const activityTypes = formatActivityTypes(definition.activityTypes)
  const prevalence = formatPrevalence(achievement, achievementPrevalence)

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
        {prevalence && (
          <p className="mt-1 text-xs font-medium text-primary">{prevalence}</p>
        )}
      </div>
    </article>
  )
}
