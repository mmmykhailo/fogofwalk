import { useEffect, useState } from "react"
import {
  CheckCircleIcon,
  ClockIcon,
  CloudArrowUpIcon,
  PaperPlaneTiltIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import type { AccessRequest } from "~shared/api"
import { Button } from "~/components/ui/button"
import { apiGet, apiPost, friendlyMessage } from "~/lib/server/apiClient"
import { refreshAuth } from "~/lib/server/authStore"

interface AccessRequestBlockProps {
  open: boolean
}

export function AccessRequestBlock({ open }: AccessRequestBlockProps) {
  const [request, setRequest] = useState<AccessRequest | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      setRequest(await apiGet<AccessRequest | null>("/api/access-request"))
      await refreshAuth()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => {
    if (open) void load()
  }, [open])
  async function submit() {
    setIsSubmitting(true)
    setError(null)
    try {
      setRequest(await apiPost<AccessRequest>("/api/access-request"))
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <section
      aria-live="polite"
      className="overflow-hidden border border-primary/20 bg-primary/[0.035]"
    >
      {!request && (
        <div className="flex gap-3 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center bg-primary/10 text-primary">
            <CloudArrowUpIcon weight="duotone" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Enable cloud sync</p>
            <p className="mt-1 text-xs/relaxed text-muted-foreground">
              {isLoading
                ? "Checking whether sync is available for your account…"
                : "Request access to keep your activities available across your devices."}
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={submit}
              disabled={isSubmitting || isLoading}
            >
              <PaperPlaneTiltIcon weight="bold" />
              {isSubmitting ? "Requesting…" : "Request access"}
            </Button>
          </div>
        </div>
      )}
      {request?.status === "pending" && (
        <div className="flex gap-3 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <ClockIcon weight="duotone" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Access request pending</p>
            <p className="mt-1 text-xs/relaxed text-muted-foreground">
              Your request is waiting for review. Reload the page later to see
              whether sync and other server features have been enabled.
            </p>
          </div>
        </div>
      )}
      {request?.status === "approved" && (
        <div className="flex gap-3 p-3">
          <CheckCircleIcon
            weight="fill"
            className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
          <div>
            <p className="text-sm font-medium">Access approved</p>
            <p className="mt-1 text-xs/relaxed text-muted-foreground">
              Refreshing your account enables sync.
            </p>
          </div>
        </div>
      )}
      {request?.status === "rejected" && (
        <div className="flex gap-3 p-3">
          <XCircleIcon
            weight="fill"
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <div>
            <p className="text-sm font-medium text-destructive">
              Access declined
            </p>
            <p className="mt-1 text-xs/relaxed text-muted-foreground">
              Contact the administrator if you think this was a mistake.
            </p>
          </div>
        </div>
      )}
      {error && (
        <p className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs/relaxed text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
