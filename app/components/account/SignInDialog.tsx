import { useCallback, useEffect, useState } from "react"
import { GithubLogoIcon, SignInIcon } from "@phosphor-icons/react"
import type { AuthProviderInfo } from "~shared/api"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { friendlyMessage } from "~/lib/server/apiClient"
import { fetchProviders } from "~/lib/server/authStore"
import { signInUrl } from "~/lib/server/config"
import { useServerHealth } from "~/lib/server/serverHealth"
import { ServerUnavailableNotice } from "./ServerUnavailableNotice"

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PROVIDER_ICONS: Record<string, typeof GithubLogoIcon> = {
  github: GithubLogoIcon,
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const [providers, setProviders] = useState<AuthProviderInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const health = useServerHealth()
  const [attempt, setAttempt] = useState(0)

  const load = useCallback(() => {
    setProviders(null)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!open) return
    let isStale = false
    fetchProviders()
      .then((res) => {
        if (!isStale) setProviders(res.providers)
      })
      .catch((err) => {
        if (!isStale) setError(friendlyMessage(err))
      })
    return () => {
      isStale = true
    }
  }, [open, attempt])

  // Network failure, not a server-side error — show the offline placeholder
  // rather than a raw message the user can do nothing with.
  const isUnreachable = health === "offline" && providers === null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Sign in to sync your tracks across devices. Your tracks stay private
            — only you can read them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isUnreachable && (
            <ServerUnavailableNotice action="sign in" onRetry={load} />
          )}

          {!isUnreachable && providers === null && !error && (
            // Placeholder shaped like the buttons it is standing in for.
            <>
              <div className="h-9 w-full animate-pulse bg-foreground/5" />
              <div className="h-9 w-full animate-pulse bg-foreground/5" />
            </>
          )}

          {!isUnreachable && providers?.length === 0 && (
            <p className="p-3 text-xs/relaxed text-muted-foreground ring-1 ring-foreground/10">
              The server has no sign-in providers configured yet.
            </p>
          )}

          {providers?.map((provider) => {
            const Icon = PROVIDER_ICONS[provider.id] ?? SignInIcon
            return (
              <Button
                key={provider.id}
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.href = signInUrl(provider.id)
                }}
              >
                <Icon weight="bold" className="mr-2" />
                Continue with {provider.label}
              </Button>
            )
          })}
        </div>

        {error && !isUnreachable && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
