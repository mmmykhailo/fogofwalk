import type { EarnedAchievement } from "~/lib/achievements"
import type { PublicAchievementPrevalence } from "~shared/api"
import { AchievementIcon } from "~/components/public-profile/AchievementIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip"

interface AchievementCardProps {
  achievement: EarnedAchievement
  achievementPrevalence?: PublicAchievementPrevalence
}

function formatPrevalence(
  achievement: EarnedAchievement,
  prevalence: PublicAchievementPrevalence | undefined
): number | null {
  return prevalence?.[achievement.definition.id] ?? null
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
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="min-w-0 flex-1 font-heading text-sm font-medium break-words">
            {definition.title}
          </h3>
          {prevalence !== null && (
            <Tooltip>
              <TooltipTrigger
                nativeButton={false}
                render={
                  <span className="shrink-0 cursor-help text-xs font-medium text-primary underline decoration-dotted underline-offset-2" />
                }
              >
                {prevalence}%
              </TooltipTrigger>
              <TooltipContent>
                {prevalence === 100
                  ? "All users have this achievement"
                  : `Only ${prevalence}% of users have this achievement`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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
