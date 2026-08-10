import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import type { AuthExchangeResponse } from "~shared/api"
import { apiPost, friendlyMessage } from "~/lib/server/apiClient"
import { completeSignIn, setSignedOut } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"
import { useServerHealth } from "~/lib/server/serverHealth"
import { AppLink } from "~/components/AppLink"
import { ServerUnavailableNotice } from "~/components/account/ServerUnavailableNotice"

/**
 * Landing point for the OAuth redirect. The server sends a single-use handoff
 * code here rather than the session token itself, so the long-lived token never
 * touches the URL bar, browser history or a `Referer` header.
 */
export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const health = useServerHealth()
  // The handoff code is single-use; React 19 StrictMode double-effects would
  // burn it on the first call and fail on the second.
  const hasRunRef = useRef(false)

  useEffect(() => {
    if (hasRunRef.current) return
    hasRunRef.current = true

    if (!isServerEnabled) {
      setError("This build has no sync server configured.")
      return
    }

    const code = searchParams.get("code")
    const oauthError = searchParams.get("error")

    if (oauthError) {
      setSignedOut()
      setError(
        oauthError === "access_denied"
          ? "Sign-in was cancelled."
          : `Sign-in failed: ${oauthError}`
      )
      return
    }
    if (!code) {
      setSignedOut()
      setError("Sign-in link was missing its code. Please try again.")
      return
    }

    void (async () => {
      try {
        const res = await apiPost<AuthExchangeResponse>(
          "/api/auth/exchange",
          { code },
          { anonymous: true }
        )
        await completeSignIn(res)
        navigate("/", { replace: true })
      } catch (err) {
        setSignedOut()
        setError(friendlyMessage(err))
      }
    })()
  }, [searchParams, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        {error ? (
          <>
            {health === "offline" ? (
              <ServerUnavailableNotice action="finish signing in" />
            ) : (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <AppLink to="/" variant="nav">
              Back to map
            </AppLink>
          </>
        ) : (
          <>
            <div className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
            <p className="text-xs text-muted-foreground">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  )
}
