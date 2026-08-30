import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { AchievementsSection } from "~/components/public-profile/AchievementsSection"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { PageShell } from "~/components/PageShell"
import { TransitionLink } from "~/components/TransitionLink"
import {
  computeEarnedAchievements,
  sortEarnedAchievementsNewestFirst,
} from "~/lib/achievements"
import { apiUrl } from "~/lib/server/config"
import { socialMeta } from "~/lib/socialMeta"
import type { PublicProfileResponse } from "~shared/api"
import type { Route } from "./+types/u.$handle.achievements"

interface AchievementsLoaderData {
  profile: PublicProfileResponse | null
  error: string | null
}

export async function clientLoader({
  params,
}: Route.ClientLoaderArgs): Promise<AchievementsLoaderData> {
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
    return { profile: (await res.json()) as PublicProfileResponse, error: null }
  } catch (err) {
    return {
      profile: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function meta({ data, params }: Route.MetaArgs) {
  const handle = data?.profile?.user.handle || params.handle || "Profile"
  const displayName = data?.profile?.user.displayName || handle
  return socialMeta({
    title: `${displayName}'s achievements — Fog of Walk`,
    description: `Public achievements earned by ${displayName} on Fog of Walk.`,
    path: `/u/${encodeURIComponent(handle)}/achievements`,
    type: "profile",
    profileHandle: handle,
  })
}

export default function PublicAchievementsPage() {
  const { profile, error } = useLoaderData<typeof clientLoader>()
  const achievements = profile
    ? sortEarnedAchievementsNewestFirst(
        computeEarnedAchievements(profile.activities)
      )
    : []

  return (
    <PageShell
      backTo={profile ? `/u/${encodeURIComponent(profile.user.handle)}` : "/"}
      backLabel={profile ? "Back to profile" : "Back to map"}
    >
      {profile && (
        <PublicProfileHeader
          user={profile.user}
          title={`${profile.user.displayName}'s achievements`}
          profilePath={`/u/${encodeURIComponent(profile.user.handle)}`}
        />
      )}

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

      {!error && profile && achievements.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <FootprintsIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">
            This user has no achievements yet
          </p>
        </div>
      )}

      {!error && profile && achievements.length > 0 && (
        <AchievementsSection achievements={achievements} showHeading={false} />
      )}
    </PageShell>
  )
}
