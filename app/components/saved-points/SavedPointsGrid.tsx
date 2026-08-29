import { Grid } from "~/components/Grid"
import { SavedPointCard } from "~/components/public-profile/SavedPointCard"
import type { SavedPoint } from "~shared/saved-points"

interface SavedPointsGridProps {
  points: SavedPoint[]
}

export function SavedPointsGrid({ points }: SavedPointsGridProps) {
  return (
    <Grid columns={{ base: 1, sm: 2 }}>
      {points.map((point) => (
        <SavedPointCard key={point.id} point={point} isOwner />
      ))}
    </Grid>
  )
}
