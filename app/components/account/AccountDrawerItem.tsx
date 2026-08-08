import { CaretRightIcon, SignInIcon } from "@phosphor-icons/react"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item"
import { useAuth } from "~/lib/server/authStore"
import { AccountAvatar } from "./AccountAvatar"

interface AccountDrawerItemProps {
  /** Opens the provider list. The drawer closes first — see MoreDrawer. */
  onSignIn: () => void
  /** Opens the account modal. */
  onOpenAccount: () => void
  /** Sync status line, when the sync engine has something to say. */
  syncStatus?: string | null
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
  syncStatus,
}: AccountDrawerItemProps) {
  const auth = useAuth()

  if (auth.status === "disabled") return null

  return (
    <>
      {auth.status === "loading" && (
        <Item variant="muted" className="opacity-50">
          <ItemMedia variant="icon">
            <span className="size-5" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Checking sign-in…</ItemTitle>
          </ItemContent>
        </Item>
      )}

      {auth.status === "signedOut" && (
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
            {(auth.canSync ? syncStatus : "Not enabled for sync") && (
              <ItemDescription>
                {auth.canSync ? syncStatus : "Not enabled for sync"}
              </ItemDescription>
            )}
          </ItemContent>
          <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Item>
      )}

      <div className="ml-10 border-t border-foreground/10" />
    </>
  )
}
