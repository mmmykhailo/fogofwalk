import type { EarnedAchievement } from "~/lib/achievements"
import type { PublicAchievementPrevalence } from "~shared/api"
import { AchievementCard } from "~/components/public-profile/AchievementCard"
import { TransitionLink } from "~/components/TransitionLink"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { Grid } from "~/components/Grid"

interface AchievementsSectionProps {
  achievements: EarnedAchievement[]
  maxAchievements?: number
  viewAllTo?: string
  groupByFamily?: boolean
  showHeading?: boolean
  achievementPrevalence?: PublicAchievementPrevalence
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
  achievementPrevalence,
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
        <div className="mt-6 mb-3">
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
                  <Grid columns={{ base: 1, sm: 2 }}>
                    {familyAchievements.map((achievement) => (
                      <AchievementCard
                        key={achievement.definition.id}
                        achievement={achievement}
                        achievementPrevalence={achievementPrevalence}
                      />
                    ))}
                  </Grid>
                </section>
              )
          )}
        </div>
      ) : (
        <Grid columns={{ base: 1, sm: 2 }}>
          {visibleAchievements.map((achievement) => (
            <AchievementCard
              key={achievement.definition.id}
              achievement={achievement}
              achievementPrevalence={achievementPrevalence}
            />
          ))}
        </Grid>
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
