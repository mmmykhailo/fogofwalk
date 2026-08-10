import { useState } from "react"
import { cn } from "~/lib/utils"

interface AccountAvatarProps {
  displayName: string
  avatarUrl: string | null
  className?: string
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Provider avatar with an initials fallback. Hand-rolled rather than pulled
 * from the registry — shadcn's `avatar` isn't installed and this is the only
 * place the app shows one.
 */
export function AccountAvatar({
  displayName,
  avatarUrl,
  className,
}: AccountAvatarProps) {
  const [isBroken, setIsBroken] = useState(false)

  if (avatarUrl && !isBroken) {
    return (
      <img
        src={avatarUrl}
        alt=""
        loading="lazy"
        onError={() => setIsBroken(true)}
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[0.5rem] font-medium text-muted-foreground",
        className
      )}
    >
      {initials(displayName)}
    </span>
  )
}
