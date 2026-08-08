import { useEffect, useState } from "react"
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

  useEffect(() => {
    if (!open) return
    let isStale = false
    setError(null)
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
  }, [open])

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
          {providers === null && !error && (
            <p className="text-xs text-muted-foreground">Loading providers…</p>
          )}
          {providers?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              The server has no sign-in providers configured.
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

        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
