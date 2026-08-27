import { useEffect, useState } from "react"
import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { AchievementsSection } from "~/components/public-profile/AchievementsSection"
import { ActivityCard } from "~/components/public-profile/ActivityCard"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { PublicActivityGrid } from "~/components/public-profile/PublicActivityGrid"
import { PublicProfileSummary } from "~/components/public-profile/PublicProfileSummary"
import { StatCards } from "~/components/stats/StatCards"
import { WeeklyChart } from "~/components/stats/WeeklyChart"
import { TransitionLink } from "~/components/TransitionLink"
import { computePublicProfileStats } from "~/lib/publicProfileStats"
import {
  computeEarnedAchievements,
  sortEarnedAchievementsNewestFirst,
} from "~/lib/achievements"
import { apiUrl } from "~/lib/server/config"
import { useAuth } from "~/lib/server/authStore"
import type { PublicProfileResponse } from "~shared/api"
import type { Route } from "./+types/u.$handle"

interface ProfileLoaderData {
  profile: PublicProfileResponse | null
  error: string | null
}

export async function clientLoader({
  params,
}: Route.ClientLoaderArgs): Promise<ProfileLoaderData> {
  const handle = params.handle
  if (!handle) return { profile: null, error: "Profile not found." }

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

export function meta({ params }: Route.MetaArgs) {
  const handle = params.handle
  return [
    { title: `${handle} — Fog of Walk` },
    {
      name: "description",
      content: `Public activities by ${handle} on Fog of Walk.`,
    },
  ]
}

export default function PublicProfilePage() {
  const { profile, error } = useLoaderData<typeof clientLoader>()
  const auth = useAuth()
  const [activities, setActivities] = useState(() => profile?.activities ?? [])

  useEffect(() => {
    setActivities(profile?.activities ?? [])
  }, [profile])

  const isOwner =
    auth.status === "signedIn" &&
    auth.canSync &&
    auth.user.handle?.toLowerCase() === profile?.user.handle.toLowerCase()
  const stats = computePublicProfileStats(activities)
  const achievements = sortEarnedAchievementsNewestFirst(
    computeEarnedAchievements(activities)
  )

  function handleActivityHidden(contentHash: string) {
    setActivities((current) =>
      current.filter((activity) => activity.contentHash !== contentHash)
    )
  }

  return (
    <PageShell>
      {profile && <PublicProfileHeader user={profile.user} />}

      {error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <TransitionLink
            to="/"
            className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </TransitionLink>
        </div>
      )}

      {!error && profile && activities.length === 0 && (
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

      {!error && profile && activities.length > 0 && (
        <div className="space-y-6">
          <StatCards totals={stats.totals} />
          <WeeklyChart weekly={stats.weekly} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PublicActivityGrid recentDays={stats.recentDays} />
            <PublicProfileSummary stats={stats} />
          </div>
          <AchievementsSection
            achievements={achievements}
            maxAchievements={4}
            viewAllTo={`/u/${encodeURIComponent(profile.user.handle)}/achievements`}
            groupByFamily={false}
          />
          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold">
              Public activities
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {activities.map((activity) => (
                <ActivityCard
                  key={activity.contentHash}
                  activity={activity}
                  isOwner={isOwner}
                  onHidden={handleActivityHidden}
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </PageShell>
  )
}
