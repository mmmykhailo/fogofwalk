import { useEffect, useState } from "react"
import { useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { AccountAvatar } from "~/components/account/AccountAvatar"
import { TrackCard } from "~/components/public-profile/TrackCard"
import { TransitionLink } from "~/components/TransitionLink"
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
      content: `Public tracks by ${handle} on Fog of Walk.`,
    },
  ]
}

export default function PublicProfilePage() {
  const { profile, error } = useLoaderData<typeof clientLoader>()
  const auth = useAuth()
  const [tracks, setTracks] = useState(() => profile?.tracks ?? [])

  useEffect(() => {
    setTracks(profile?.tracks ?? [])
  }, [profile])

  const isOwner =
    auth.status === "signedIn" &&
    auth.canSync &&
    auth.user.handle?.toLowerCase() === profile?.user.handle.toLowerCase()

  function handleTrackHidden(contentHash: string) {
    setTracks((current) =>
      current.filter((track) => track.contentHash !== contentHash)
    )
  }

  return (
    <PageShell>
      {profile && (
        <div className="mb-8 flex items-center gap-4">
          <AccountAvatar
            displayName={profile.user.displayName}
            avatarUrl={profile.user.avatarUrl}
            className="size-16"
          />
          <div>
            <h1 className="text-xl font-semibold">
              {profile.user.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">
              @{profile.user.handle}
            </p>
          </div>
        </div>
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

      {!error && profile && tracks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <FootprintsIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">
            This user has no public tracks yet
          </p>
        </div>
      )}

      {!error && profile && tracks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tracks.map((track) => (
            <TrackCard
              key={track.contentHash}
              track={track}
              isOwner={isOwner}
              onHidden={handleTrackHidden}
            />
          ))}
        </div>
      )}
    </PageShell>
  )
}
