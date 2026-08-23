import { useEffect, useState } from "react"
import type { AccessRequest } from "~shared/api"
import { Button } from "~/components/ui/button"
import { apiGet, apiPost, friendlyMessage } from "~/lib/server/apiClient"
import { refreshAuth } from "~/lib/server/authStore"

interface AccessRequestBlockProps { open: boolean }

export function AccessRequestBlock({ open }: AccessRequestBlockProps) {
  const [request, setRequest] = useState<AccessRequest | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    setIsLoading(true); setError(null)
    try { setRequest(await apiGet<AccessRequest | null>("/api/access-request")); await refreshAuth() }
    catch (err) { setError(friendlyMessage(err)) } finally { setIsLoading(false) }
  }
  useEffect(() => { if (open) void load() }, [open])
  useEffect(() => {
    if (!open || request?.status !== "pending") return
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [open, request?.status])
  async function submit() {
    setIsSubmitting(true); setError(null)
    try { setRequest(await apiPost<AccessRequest>("/api/access-request")) }
    catch (err) { setError(friendlyMessage(err)) } finally { setIsSubmitting(false) }
  }
  return <div className="space-y-2 p-3 text-xs ring-1 ring-foreground/10">
    {!request && <><p>Your account isn’t enabled for sync yet.</p><Button size="sm" onClick={submit} disabled={isSubmitting || isLoading}>{isSubmitting ? "Requesting…" : "Request access"}</Button></>}
    {request?.status === "pending" && <><p>Your access request is pending review.</p><Button size="sm" variant="outline" onClick={() => void load()} disabled={isLoading}>Refresh</Button></>}
    {request?.status === "approved" && <p>Access approved. Refreshing your account enables sync.</p>}
    {request?.status === "rejected" && <p>Your access request was declined. Contact the administrator for help.</p>}
    {error && <p className="text-destructive">{error}</p>}
  </div>
}
