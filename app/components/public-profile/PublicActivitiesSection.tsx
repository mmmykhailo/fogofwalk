import type { Ref } from "react"
import { ActivityCard } from "~/components/activity/ActivityCard"
import { Grid } from "~/components/Grid"
import { Pagination } from "~/components/Pagination"
import { PublicActivityOwnerActions } from "~/components/public-profile/PublicActivityOwnerActions"
import { TransitionLink } from "~/components/TransitionLink"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import type { PublicActivitySummary } from "~shared/api"

interface PublicActivitiesPagination {
  itemCount: number
  pageSize: number
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

interface PublicActivitiesSectionProps {
  activities: PublicActivitySummary[]
  maxActivities?: number
  viewAllTo?: string
  hasMore?: boolean
  showHeading?: boolean
  heading?: string
  headingRef?: Ref<HTMLHeadingElement>
  isOwner?: boolean
  pagination?: PublicActivitiesPagination
}

export function PublicActivitiesSection({
  activities,
  maxActivities,
  viewAllTo,
  hasMore = false,
  showHeading = true,
  heading = "Public activities",
  headingRef,
  isOwner = false,
  pagination,
}: PublicActivitiesSectionProps) {
  const visibleActivities = activities.slice(0, maxActivities)
  const hasHiddenActivities =
    visibleActivities.length < activities.length || hasMore

  return (
    <section
      aria-labelledby={showHeading ? "public-activities-heading" : undefined}
      aria-label={showHeading ? undefined : "Public activities"}
    >
      {showHeading && (
        <div className="mt-6 mb-3">
          <h2
            id="public-activities-heading"
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="font-heading text-lg font-semibold outline-none"
          >
            {heading}
          </h2>
        </div>
      )}
      <Grid columns={{ base: 1, sm: 2 }}>
        {visibleActivities.map((activity) => (
          <ActivityCard
            key={activity.contentHash}
            activity={activity}
            activityId={activity.contentHash}
            actions={
              isOwner ? (
                <PublicActivityOwnerActions
                  activityName={activity.name}
                  contentHash={activity.contentHash}
                />
              ) : undefined
            }
          />
        ))}
      </Grid>
      {hasHiddenActivities && viewAllTo && (
        <TransitionLink
          to={viewAllTo}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-3"
          )}
        >
          View all activities
        </TransitionLink>
      )}
      {pagination && (
        <Pagination {...pagination} itemLabel="public activities" />
      )}
    </section>
  )
}
