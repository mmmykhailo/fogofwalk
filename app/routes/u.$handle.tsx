import { Link, useLoaderData } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { AccountAvatar } from "~/components/account/AccountAvatar"
import { apiUrl } from "~/lib/server/config"
import type { PublicProfileResponse, PublicTrackMeta } from "~shared/api"
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "~/components/track-stats/formatters"
import type { Route } from "./+types/u.$handle"

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".")
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

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
          <Link
            to="/"
            className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </Link>
        </div>
      )}

      {!error && profile && profile.tracks.length === 0 && (
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

      {!error && profile && profile.tracks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {profile.tracks.map((track) => (
            <TrackCard key={track.contentHash} track={track} />
          ))}
        </div>
      )}
    </PageShell>
  )
}

function TrackCard({ track }: { track: PublicTrackMeta }) {
  return (
    <div className="flex flex-col gap-2 rounded-none bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <h3 className="font-heading text-sm font-medium">
        {stripExtension(track.name)}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Stat label="Distance" value={formatDistance(track.distanceKm)} />
        {track.durationMs != null && (
          <Stat label="Duration" value={formatDuration(track.durationMs)} />
        )}
        {track.elevationGainM > 0 && (
          <Stat
            label="Elevation gain"
            value={formatElevation(track.elevationGainM)}
          />
        )}
        {track.avgMovingSpeedKmh != null && (
          <Stat
            label="Moving speed"
            value={formatSpeed(track.avgMovingSpeedKmh)}
          />
        )}
      </dl>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
