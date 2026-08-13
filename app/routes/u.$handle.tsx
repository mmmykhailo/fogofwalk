import { useEffect, useState } from "react"
import { useParams, Link } from "react-router"
import { FootprintsIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { AccountAvatar } from "~/components/account/AccountAvatar"
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

async function fetchProfile(handle: string): Promise<PublicProfileResponse> {
  const res = await fetch(`/api/public/users/${encodeURIComponent(handle)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || "Profile not found.")
  }
  return (await res.json()) as PublicProfileResponse
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
  const { handle } = useParams<{ handle: string }>()
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!handle) return
    setIsLoading(true)
    setError(null)
    fetchProfile(handle)
      .then(setProfile)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setIsLoading(false))
  }, [handle])

  const title = profile?.user.displayName ?? handle ?? "Profile"

  return (
    <PageShell title={title}>
      {profile && (
        <div className="mb-8 flex items-center gap-4">
          <AccountAvatar
            displayName={profile.user.displayName}
            avatarUrl={profile.user.avatarUrl}
            className="size-16"
          />
          <div>
            <h2 className="text-xl font-semibold">
              {profile.user.displayName}
            </h2>
            <p className="text-sm text-muted-foreground">
              @{profile.user.handle}
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
        </div>
      )}

      {error && !isLoading && (
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

      {!isLoading && !error && profile && profile.tracks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <FootprintsIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">No public tracks yet.</p>
          <Link
            to="/"
            className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </Link>
        </div>
      )}

      {!isLoading && !error && profile && profile.tracks.length > 0 && (
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
