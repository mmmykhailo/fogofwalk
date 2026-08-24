import { useState } from "react"
import { CloudSlashIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"
import { pingServer } from "~/lib/server/serverHealth"

interface ServerUnavailableNoticeProps {
  /** What the user was trying to do, e.g. "sign in". */
  action?: string
  /** Re-run after a successful ping — refetch whatever failed. */
  onRetry?: () => void
}

/**
 * The placeholder every server-backed surface falls back to when the sync
 * server can't be reached. Says plainly that this is the server's fault and
 * that local data is unaffected — the app works offline by design.
 */
export function ServerUnavailableNotice({
  action,
  onRetry,
}: ServerUnavailableNoticeProps) {
  const [isRetrying, setIsRetrying] = useState(false)

  async function handleRetry() {
    setIsRetrying(true)
    const isUp = await pingServer()
    setIsRetrying(false)
    if (isUp) onRetry?.()
  }

  return (
    <div className="space-y-2 p-3 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <CloudSlashIcon
          weight="duotone"
          className="size-5 shrink-0 text-muted-foreground"
        />
        <p className="text-sm font-medium">Server unavailable</p>
      </div>
      <p className="text-xs/relaxed text-muted-foreground">
        {action
          ? `Can't reach the sync server, so you can't ${action} right now. `
          : "Can't reach the sync server right now. "}
        Your activities on this device are unaffected — the map keeps working
        offline.
      </p>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={isRetrying}
        >
          {isRetrying ? "Checking…" : "Try again"}
        </Button>
      </div>
    </div>
  )
}
