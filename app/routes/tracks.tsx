import { useLoaderData } from "react-router"
import { EmptyTracksState } from "~/components/my-tracks/EmptyTracksState"
import { TrackGrid } from "~/components/my-tracks/TrackGrid"
import { PageShell } from "~/components/PageShell"
import { mapStore } from "~/lib/mapStore"
import { loadTracks } from "~/lib/storage"
import { sortTracks } from "~/lib/statsAggregator"
import type { ParsedTrack } from "~/types/tracks"
import type { Route } from "./+types/tracks"

export async function clientLoader(): Promise<ParsedTrack[]> {
  const tracks =
    mapStore.tracks.length > 0 ? mapStore.tracks : await loadTracks()
  return sortTracks(tracks)
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "My tracks — Fog of Walk" },
    { name: "description", content: "Your imported activity tracks." },
  ]
}

export default function MyTracksPage() {
  const tracks = useLoaderData<typeof clientLoader>()

  return (
    <PageShell title="My tracks">
      {tracks.length === 0 ? (
        <EmptyTracksState />
      ) : (
        <TrackGrid tracks={tracks} />
      )}
    </PageShell>
  )
}
