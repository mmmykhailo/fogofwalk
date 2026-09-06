import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { AchievementsSection } from "~/components/public-profile/AchievementsSection"
import { SavedPointsSection } from "~/components/public-profile/SavedPointsSection"
import { PublicActivityCard } from "~/components/public-profile/PublicActivityCard"
import { PublicActivityOwnerActions } from "~/components/public-profile/PublicActivityOwnerActions"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { RecentActivityCalendarCard } from "~/components/public-profile/RecentActivityCalendarCard"
import { PublicProfileSummary } from "~/components/public-profile/PublicProfileSummary"
import { StatCards } from "~/components/stats/StatCards"
import { WeeklyChart } from "~/components/stats/WeeklyChart"
import { TransitionLink } from "~/components/TransitionLink"
import { Grid } from "~/components/Grid"
import { computePublicProfileStats } from "~/lib/publicProfileStats"
import { socialMeta } from "~/lib/socialMeta"
import {
  computeEarnedAchievements,
  sortEarnedAchievementsNewestFirst,
} from "~/lib/achievements"
import { applyActivityMetadata, mapStore } from "~/lib/mapStore"
import { apiUrl } from "~/lib/server/config"
import {
  canSync,
  getAuthState,
  initAuth,
  useAuth,
} from "~/lib/server/authStore"
import { friendlyMessage } from "~/lib/server/apiClient"
import { updateActivityVisibility } from "~/lib/server/activityVisibility"
import {
  activityToSummary,
  loadActivitySummaries,
  updateActivityMetadata,
} from "~/lib/storage"
import type { PublicProfileResponse } from "~shared/api"
import type { Route } from "./+types/u.$handle"

const MAX_WEEKLY_CHART_DAYS = 180

interface ProfileLoaderData {
  profile: PublicProfileResponse | null
  error: string | null
}

export type PublicProfileActionResult =
  | { ok: true; intent: "hide-activity"; contentHash: string }
  | { ok: false; intent: "hide-activity"; error: string }

const CONTENT_HASH_RE = /^[a-f0-9]{64}$/

export async function clientLoader({
  params,
}: Route.ClientLoaderArgs): Promise<ProfileLoaderData> {
  const handle = params.handle
  if (!handle) return { profile: null, error: "Profile not found." }

  // Public profile data stays anonymous. Start restoring a stored session only
  // because this route can render owner-specific activity controls.
  void initAuth()

  try {
    const res = await fetch(
      apiUrl(`/api/public/users/${encodeURIComponent(handle)}`)
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || "Profile not found.")
    }
    const profile = (await res.json()) as PublicProfileResponse
    return { profile, error: null }
  } catch (err) {
    return {
      profile: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function failedHide(error: string): PublicProfileActionResult {
  return { ok: false, intent: "hide-activity", error }
}

async function reconcileLocalVisibility(contentHash: string): Promise<void> {
  const summaries =
    mapStore.activityHydration === "full"
      ? mapStore.activities.map(activityToSummary)
      : mapStore.activityHydration === "summaries"
        ? mapStore.activitySummaries
        : await loadActivitySummaries()
  const summary = summaries.find(
    (activity) => activity.contentHash === contentHash
  )
  if (!summary) return

  const updated = { ...summary, isPublic: false }
  if (!(await updateActivityMetadata([{ id: updated.id, isPublic: false }]))) {
    throw new Error("The local activity summary could not be updated.")
  }
  applyActivityMetadata([updated])
}

export async function clientAction({
  params,
  request,
}: Route.ClientActionArgs): Promise<PublicProfileActionResult> {
  const formData = await request.formData()
  if (formData.get("intent") !== "hide-activity") {
    return failedHide("Unknown profile action.")
  }

  const contentHash = formData.get("contentHash")
  if (typeof contentHash !== "string" || !CONTENT_HASH_RE.test(contentHash)) {
    return failedHide("Activity identity is invalid.")
  }

  await initAuth()
  const auth = getAuthState()
  const profileHandle = params.handle
  if (auth.status !== "signedIn" || !canSync()) {
    return failedHide("Sign in with sync access to manage public activities.")
  }
  if (
    !profileHandle ||
    !auth.user.handle ||
    auth.user.handle.toLowerCase() !== profileHandle.toLowerCase()
  ) {
    return failedHide("You can only manage activities on your own profile.")
  }

  try {
    await updateActivityVisibility(contentHash, false)
  } catch (err) {
    return failedHide(friendlyMessage(err))
  }

  try {
    await reconcileLocalVisibility(contentHash)
  } catch (err) {
    console.warn(
      "[public-profile] local visibility reconciliation failed:",
      err
    )
  }

  return { ok: true, intent: "hide-activity", contentHash }
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
  // The profile response carries only a bounded preview. Pagination replaces
  // this collection with the authoritative activity-card loader.
  const activities = profile?.recentActivities ?? []

  const isOwner =
    auth.status === "signedIn" &&
    auth.user.handle?.toLowerCase() === profile?.user.handle.toLowerCase()
  const stats = computePublicProfileStats(activities)
  const weeklyChart = stats.weekly.slice(-Math.floor(MAX_WEEKLY_CHART_DAYS / 7))
  const achievements = sortEarnedAchievementsNewestFirst(
    computeEarnedAchievements(activities)
  )
  const savedPoints = profile?.savedPoints ?? []

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
        activities.length === 0 &&
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
        (activities.length > 0 || savedPoints.length > 0) && (
          <div className="space-y-3">
            {activities.length > 0 && (
              <>
                <StatCards totals={stats.totals} />
                <WeeklyChart weekly={weeklyChart} />
                <Grid columns={{ base: 1, sm: 2 }}>
                  <RecentActivityCalendarCard recentDays={stats.recentDays} />
                  <PublicProfileSummary stats={stats} />
                </Grid>
                <AchievementsSection
                  achievements={achievements}
                  maxAchievements={4}
                  viewAllTo={`/u/${encodeURIComponent(profile.user.handle)}/achievements`}
                  groupByFamily={false}
                  achievementPrevalence={profile.achievementPrevalence}
                />
                <section>
                  <h2 className="mt-6 mb-3 font-heading text-lg font-semibold">
                    Public activities
                  </h2>
                  <Grid columns={{ base: 1, sm: 2 }}>
                    {activities.map((activity) => (
                      <PublicActivityCard
                        key={`${profile.user.handle.toLowerCase()}:${activity.contentHash}`}
                        activity={activity}
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
                </section>
              </>
            )}
            <SavedPointsSection
              points={savedPoints}
              maxPoints={4}
              viewAllTo={`/u/${encodeURIComponent(profile.user.handle)}/saved-points`}
            />
          </div>
        )}
    </PageShell>
  )
}
