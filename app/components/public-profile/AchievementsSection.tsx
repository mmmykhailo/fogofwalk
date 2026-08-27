import type { EarnedAchievement } from "~/lib/achievements"
import { AchievementCard } from "~/components/public-profile/AchievementCard"

interface AchievementsSectionProps {
  achievements: EarnedAchievement[]
}

const familyLabels = {
  duration: "Time",
  elevation: "Elevation gain",
  sun: "Time of day",
  distance: "Distance",
} as const

export function AchievementsSection({
  achievements,
}: AchievementsSectionProps) {
  if (achievements.length === 0) return null

  const achievementsByFamily = Object.entries(familyLabels).map(
    ([family, label]) => ({
      family,
      label,
      achievements: achievements.filter(
        (achievement) => achievement.definition.family === family
      ),
    })
  )

  return (
    <section aria-labelledby="achievements-heading">
      <div className="mb-3">
        <h2
          id="achievements-heading"
          className="font-heading text-lg font-semibold"
        >
          Achievements
        </h2>
      </div>
      <div className="space-y-5">
        {achievementsByFamily.map(
          ({ family, label, achievements: familyAchievements }) =>
            familyAchievements.length > 0 && (
              <section key={family} aria-labelledby={`${family}-achievements`}>
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
    </section>
  )
}
