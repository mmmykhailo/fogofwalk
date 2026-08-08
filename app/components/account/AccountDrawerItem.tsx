import {
  CaretRightIcon,
  CloudSlashIcon,
  SignInIcon,
} from "@phosphor-icons/react"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item"
import { useAuth } from "~/lib/server/authStore"
import { useServerHealth } from "~/lib/server/serverHealth"
import {
  describeSyncStatus,
  useIsAutoSyncSuspended,
  useSyncStatus,
} from "~/lib/server/syncEngine"
import { AccountAvatar } from "./AccountAvatar"

interface AccountDrawerItemProps {
  /** Opens the provider list. The drawer closes first — see MoreDrawer. */
  onSignIn: () => void
  /** Opens the account modal. */
  onOpenAccount: () => void
}

/**
 * The account row at the top of the drawer's navigation card.
 *
 * Renders a fragment — the row plus the inset separator that divides it from
 * "Statistics" — so that a build with no sync server leaves no orphaned rule
 * behind. That null return is what keeps the GitHub Pages deployment identical
 * to the pre-server app.
 */
export function AccountDrawerItem({
  onSignIn,
  onOpenAccount,
}: AccountDrawerItemProps) {
  const auth = useAuth()
  // Probe when the drawer opens: a signed-out user makes no requests, so
  // without this the row could not tell "no account" from "server is down".
  const health = useServerHealth(true)
  const syncStatus = useSyncStatus()
  const isSuspended = useIsAutoSyncSuspended()

  if (auth.status === "disabled") return null

  const isOffline = health === "offline"

  // Signed out with no reachable server: sign-in cannot work, so say so
  // instead of offering a button that opens an empty provider list.
  const isSignInBlocked = auth.status === "signedOut" && isOffline

  let description: string | null = null
  if (auth.status === "signedIn") {
    if (!auth.canSync) description = "Not enabled for sync"
    else if (isSuspended) description = "Sync paused — reload to resume"
    else if (isOffline) description = "Offline — will sync later"
    else description = describeSyncStatus(syncStatus)
  }

  return (
    <>
      {auth.status === "loading" && (
        <Item variant="muted" className="opacity-50">
          <ItemMedia variant="icon">
            <span className="size-5 animate-pulse rounded-full bg-foreground/10" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              <span className="inline-block h-3 w-24 animate-pulse rounded bg-foreground/10 align-middle" />
            </ItemTitle>
          </ItemContent>
        </Item>
      )}

      {isSignInBlocked && (
        <Item variant="muted" className="opacity-60">
          <ItemMedia variant="icon">
            <CloudSlashIcon
              weight="duotone"
              className="size-5 text-muted-foreground"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Sign in unavailable</ItemTitle>
            <ItemDescription>Server unreachable</ItemDescription>
          </ItemContent>
        </Item>
      )}

      {auth.status === "signedOut" && !isSignInBlocked && (
        <Item
          variant="muted"
          render={<button type="button" />}
          onClick={onSignIn}
          className="active:brightness-95"
        >
          <ItemMedia variant="icon">
            <SignInIcon
              weight="duotone"
              className="size-5 text-muted-foreground"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Sign in</ItemTitle>
          </ItemContent>
          <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Item>
      )}

      {auth.status === "signedIn" && (
        <Item
          data-testid="account-row"
          variant="muted"
          render={<button type="button" />}
          onClick={onOpenAccount}
          className="active:brightness-95"
        >
          <ItemMedia variant="icon">
            <AccountAvatar
              displayName={auth.user.displayName}
              avatarUrl={auth.user.avatarUrl}
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="truncate">{auth.user.displayName}</ItemTitle>
            {description && <ItemDescription>{description}</ItemDescription>}
          </ItemContent>
          <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Item>
      )}

      <div className="ml-10 border-t border-foreground/10" />
    </>
  )
}
