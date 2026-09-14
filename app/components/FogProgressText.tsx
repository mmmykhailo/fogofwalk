import { useFogStatus } from "~/lib/mapStore"

export function FogProgressText() {
  const status = useFogStatus()
  return (
    <>
      {status.phase === "recovering"
        ? "Rebuilding fog…"
        : `Processing ${status.processed} of ${status.total}…`}
    </>
  )
}
