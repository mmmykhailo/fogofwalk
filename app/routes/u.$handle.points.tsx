import { MapPinIcon } from "@phosphor-icons/react"
import { useLoaderData } from "react-router"
import { PageShell } from "~/components/PageShell"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { SavedPointsSection } from "~/components/public-profile/SavedPointsSection"
import { TransitionLink } from "~/components/TransitionLink"
import { apiUrl } from "~/lib/server/config"
import { socialMeta } from "~/lib/socialMeta"
import type { PublicProfileResponse } from "~shared/api"
import type { Route } from "./+types/u.$handle.points"

interface SavedPointsLoaderData {
  profile: PublicProfileResponse | null
  error: string | null
}

export async function clientLoader({
  params,
}: Route.ClientLoaderArgs): Promise<SavedPointsLoaderData> {
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
    title: `${displayName}'s saved points — Fog of Walk`,
    description: `Public saved points by ${displayName} on Fog of Walk.`,
    path: `/u/${encodeURIComponent(handle)}/points`,
    type: "profile",
    profileHandle: handle,
  })
}

export default function PublicSavedPointsPage() {
  const { profile, error } = useLoaderData<typeof clientLoader>()
  const points = profile?.savedPoints ?? []

  return (
    <PageShell
      backTo={profile ? `/u/${encodeURIComponent(profile.user.handle)}` : "/"}
      backLabel={profile ? "Back to profile" : "Back to map"}
    >
      {profile && (
        <PublicProfileHeader
          user={profile.user}
          title={`${profile.user.displayName}'s saved points`}
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

      {!error && profile && points.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <MapPinIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">
            This user has no public saved points yet
          </p>
        </div>
      )}

      {!error && profile && points.length > 0 && (
        <SavedPointsSection points={points} showHeading={false} />
      )}
    </PageShell>
  )
}
