import { AccountAvatar } from "~/components/account/AccountAvatar"
import { TransitionLink } from "~/components/TransitionLink"
import type { PublicProfileUser } from "~shared/api"

interface PublicProfileHeaderProps {
  user: PublicProfileUser
  title?: string
  profilePath?: string
}

export function PublicProfileHeader({
  user,
  title = user.displayName,
  profilePath,
}: PublicProfileHeaderProps) {
  return (
    <div className="mb-8 flex items-center gap-4">
      <AccountAvatar
        displayName={user.displayName}
        avatarUrl={user.avatarUrl}
        className="size-16"
      />
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {profilePath ? (
          <TransitionLink
            to={profilePath}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            @{user.handle}
          </TransitionLink>
        ) : (
          <p className="text-sm text-muted-foreground">@{user.handle}</p>
        )}
      </div>
    </div>
  )
}
