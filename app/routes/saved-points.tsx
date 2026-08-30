import { useLoaderData } from "react-router"
import { EmptySavedPointsState } from "~/components/saved-points/EmptySavedPointsState"
import { SavedPointsGrid } from "~/components/saved-points/SavedPointsGrid"
import { PageShell } from "~/components/PageShell"
import { loadSavedPoints } from "~/lib/storage"
import type { SavedPoint } from "~shared/saved-points"

export async function clientLoader(): Promise<SavedPoint[]> {
  const points = await loadSavedPoints()
  return points.sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  )
}

export function meta() {
  return [
    { title: "My saved points — Fog of Walk" },
    { name: "description", content: "Your saved map points." },
  ]
}

export default function MySavedPointsPage() {
  const points = useLoaderData<typeof clientLoader>()

  return (
    <PageShell title="My saved points">
      {points.length === 0 ? (
        <EmptySavedPointsState />
      ) : (
        <SavedPointsGrid points={points} />
      )}
    </PageShell>
  )
}
