import type { PublicSavedPoint } from "~shared/api"
import { Grid } from "~/components/Grid"
import { TransitionLink } from "~/components/TransitionLink"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { PublicSavedPointCard } from "./PublicSavedPointCard"

interface SavedPointsSectionProps {
  points: PublicSavedPoint[]
  isOwner?: boolean
  maxPoints?: number
  viewAllTo?: string
  showHeading?: boolean
}

export function SavedPointsSection({
  points,
  isOwner = false,
  maxPoints,
  viewAllTo,
  showHeading = true,
}: SavedPointsSectionProps) {
  if (points.length === 0) return null

  const visiblePoints = points.slice(0, maxPoints)
  const hasHiddenPoints = visiblePoints.length < points.length

  return (
    <section
      aria-labelledby={showHeading ? "saved-points-heading" : undefined}
      aria-label={showHeading ? undefined : "Saved points"}
    >
      {showHeading && (
        <div className="mt-6 mb-3">
          <h2
            id="saved-points-heading"
            className="font-heading text-lg font-semibold"
          >
            Saved points
          </h2>
        </div>
      )}
      <Grid columns={{ base: 1, sm: 2 }}>
        {visiblePoints.map((point) => (
          <PublicSavedPointCard
            key={point.id}
            point={point}
            isOwner={isOwner}
          />
        ))}
      </Grid>
      {hasHiddenPoints && viewAllTo && (
        <TransitionLink
          to={viewAllTo}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-3"
          )}
        >
          View all points
        </TransitionLink>
      )}
    </section>
  )
}
