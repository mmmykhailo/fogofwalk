/**
 * Mapping from the internal `User` row to the wire `ServerUser`, in one place
 * so `/api/me` and `/api/auth/exchange` can never disagree.
 */

import type { ServerUser, UserCapabilities } from "~shared/api"

import type { ServerStore, User } from "./store/types"

export function capabilitiesFor(user: User): UserCapabilities {
  return { sync: user.status === "allowed" }
}

/**
 * `sessions` has no provider column, so the reported provider is the user's
 * earliest identity. With a single provider configured the two are the same
 * thing; once several exist this is "the account you originally signed up
 * with", which is what the account dialog wants to show anyway.
 */
export async function toServerUser(
  store: ServerStore,
  user: User
): Promise<ServerUser> {
  const identity = await store.findPrimaryIdentity(user.id)
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    handle: user.handle,
    provider: identity?.provider ?? "unknown",
    status: user.status,
  }
}
