import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { Grid } from "~/components/Grid"
import { PublicActivitiesSection } from "~/components/public-profile/PublicActivitiesSection"
import { AchievementsSection } from "~/components/public-profile/AchievementsSection"
import { SavedPointsSection } from "~/components/public-profile/SavedPointsSection"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { RecentActivityCalendarCard } from "~/components/public-profile/RecentActivityCalendarCard"
import { PublicProfileSummary } from "~/components/public-profile/PublicProfileSummary"
import { StatCards } from "~/components/stats/StatCards"
import { WeeklyChart } from "~/components/stats/WeeklyChart"
import { TransitionLink } from "~/components/TransitionLink"
import {
  sortEarnedAchievementsNewestFirst,
  toEarnedAchievements,
} from "~/lib/achievements"
import { handlePublicActivityAction } from "~/lib/publicActivityActions"
import { apiUrl } from "~/lib/server/config"
import { initAuth, useAuth } from "~/lib/server/authStore"
import { socialMeta } from "~/lib/socialMeta"
import type { PublicProfileResponse } from "~shared/api"
import type { Route } from "./+types/u.$handle"

const MAX_WEEKLY_CHART_DAYS = 180

interface ProfileLoaderData {
  profile: PublicProfileResponse | null
  error: string | null
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<ProfileLoaderData> {
  const handle = params.handle
  if (!handle) return { profile: null, error: "Profile not found." }

  // Public profile data stays anonymous. Start restoring a stored session only
  // because this route can render owner-specific activity controls.
  void initAuth()

  try {
    const response = await fetch(
      apiUrl(`/api/public/users/${encodeURIComponent(handle)}`),
      { signal: request.signal }
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.message || "Profile not found.")
    }
    return {
      profile: (await response.json()) as PublicProfileResponse,
      error: null,
    }
  } catch (err) {
    return {
      profile: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function clientAction({
  params,
  request,
}: Route.ClientActionArgs) {
  return handlePublicActivityAction({
    profileHandle: params.handle,
    request,
  })
}

export function meta({ data, params }: Route.MetaArgs) {
  const handle = data?.profile?.user.handle || params.handle || "Profile"
  const displayName = data?.profile?.user.displayName || handle
  return socialMeta({
    title: `${displayName} — Fog of Walk`,
    description: `Public activities by ${displayName} on Fog of Walk.`,
    path: `/u/${encodeURIComponent(handle)}`,
    type: "profile",
    profileHandle: handle,
  })
}

export default function PublicProfilePage() {
  const { profile, error } = useLoaderData<typeof clientLoader>()
  const auth = useAuth()
  const isOwner =
    auth.status === "signedIn" &&
    auth.user.handle?.toLowerCase() === profile?.user.handle.toLowerCase()
  const weeklyChart = profile?.weekly.slice(
    -Math.floor(MAX_WEEKLY_CHART_DAYS / 7)
  )
  const achievements = sortEarnedAchievementsNewestFirst(
    toEarnedAchievements(profile?.achievements ?? [])
  )
  const savedPoints = profile?.savedPoints ?? []
  const recentActivities = profile?.recentActivities ?? []
  const hasMoreActivities =
    profile != null && profile.totals.totalActivities > recentActivities.length
  const profilePath = profile
    ? `/u/${encodeURIComponent(profile.user.handle)}`
    : "/map"

  return (
    <PageShell>
      {profile && <PublicProfileHeader user={profile.user} />}

      {error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <TransitionLink
            to="/map"
            className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </TransitionLink>
        </div>
      )}

      {!error &&
        profile &&
        profile.totals.totalActivities === 0 &&
        savedPoints.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
            <FootprintsIcon
              size={40}
              className="text-muted-foreground"
              weight="duotone"
            />
            <p className="text-sm text-muted-foreground">
              This user has no public activities yet
            </p>
          </div>
        )}

      {!error &&
        profile &&
        (profile.totals.totalActivities > 0 || savedPoints.length > 0) && (
          <div className="space-y-3">
            {profile.totals.totalActivities > 0 && (
              <>
                <StatCards totals={profile.totals} />
                <WeeklyChart weekly={weeklyChart ?? []} />
                <Grid columns={{ base: 1, sm: 2 }}>
                  <RecentActivityCalendarCard recentDays={profile.recentDays} />
                  <PublicProfileSummary
                    stats={{
                      totals: profile.totals,
                      firstActivityMs: profile.firstActivityMs,
                      latestActivityMs: profile.latestActivityMs,
                      recentDays: profile.recentDays,
                      weekly: profile.weekly,
                    }}
                  />
                </Grid>
                <AchievementsSection
                  achievements={achievements}
                  maxAchievements={4}
                  viewAllTo={`${profilePath}/achievements`}
                  groupByFamily={false}
                  achievementPrevalence={profile.achievementPrevalence}
                />
                <PublicActivitiesSection
                  activities={recentActivities}
                  maxActivities={4}
                  hasMore={hasMoreActivities}
                  viewAllTo={
                    hasMoreActivities ? `${profilePath}/activities` : undefined
                  }
                  isOwner={isOwner}
                />
              </>
            )}
            <SavedPointsSection
              points={savedPoints}
              maxPoints={4}
              hasMore={profile.savedPointCount > savedPoints.length}
              viewAllTo={`${profilePath}/saved-points`}
            />
          </div>
        )}
    </PageShell>
  )
}
