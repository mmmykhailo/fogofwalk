import type { ServerUser, UserCapabilities } from "~shared/api"

export function makeServerUser(
  overrides: Partial<ServerUser> = {}
): ServerUser {
  return {
    id: "user-fixture-1",
    displayName: "Alex Trail",
    avatarUrl: "https://example.test/avatar/alex.png",
    handle: "alex-trail",
    provider: "github",
    status: "allowed",
    ...overrides,
  }
}

export function makeUserCapabilities(
  overrides: Partial<UserCapabilities> = {}
): UserCapabilities {
  return {
    sync: true,
    admin: false,
    ...overrides,
  }
}
