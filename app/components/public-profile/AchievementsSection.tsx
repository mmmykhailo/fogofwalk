import type { EarnedAchievement } from "~/lib/achievements"
import { AchievementCard } from "~/components/public-profile/AchievementCard"
import { TransitionLink } from "~/components/TransitionLink"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"

interface AchievementsSectionProps {
  achievements: EarnedAchievement[]
  maxAchievements?: number
  viewAllTo?: string
  groupByFamily?: boolean
  showHeading?: boolean
}

const familyLabels = {
  duration: "Time",
  elevation: "Elevation gain",
  sun: "Time of day",
  distance: "Distance",
} as const

export function AchievementsSection({
  achievements,
  maxAchievements,
  viewAllTo,
  groupByFamily = true,
  showHeading = true,
}: AchievementsSectionProps) {
  if (achievements.length === 0) return null

  const visibleAchievements = achievements.slice(0, maxAchievements)
  const hasHiddenAchievements = visibleAchievements.length < achievements.length

  const achievementsByFamily = groupByFamily
    ? Object.entries(familyLabels).map(([family, label]) => ({
        family,
        label,
        achievements: visibleAchievements.filter(
          (achievement) => achievement.definition.family === family
        ),
      }))
    : null

  return (
    <section
      aria-labelledby={showHeading ? "achievements-heading" : undefined}
      aria-label={showHeading ? undefined : "Achievements"}
    >
      {showHeading && (
        <div className="mb-3">
          <h2
            id="achievements-heading"
            className="font-heading text-lg font-semibold"
          >
            Achievements
          </h2>
        </div>
      )}
      {achievementsByFamily ? (
        <div className="space-y-5">
          {achievementsByFamily.map(
            ({ family, label, achievements: familyAchievements }) =>
              familyAchievements.length > 0 && (
                <section
                  key={family}
                  aria-labelledby={`${family}-achievements`}
                >
                  <h3
                    id={`${family}-achievements`}
                    className="mb-2 text-sm font-medium text-muted-foreground"
                  >
                    {label}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {familyAchievements.map((achievement) => (
                      <AchievementCard
                        key={achievement.definition.id}
                        achievement={achievement}
                      />
                    ))}
                  </div>
                </section>
              )
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleAchievements.map((achievement) => (
            <AchievementCard
              key={achievement.definition.id}
              achievement={achievement}
            />
          ))}
        </div>
      )}
      {hasHiddenAchievements && viewAllTo && (
        <TransitionLink
          to={viewAllTo}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-3"
          )}
        >
          View all achievements
        </TransitionLink>
      )}
    </section>
  )
}
