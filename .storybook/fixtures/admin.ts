import type { AdminAccessRequest, AdminUser } from "~shared/api"

import { FIXTURE_ACTIVITY_START_MS } from "./activities"
import { makeServerUser } from "./auth"

export function makeAccessRequest(
  overrides: Partial<AdminAccessRequest> = {}
): AdminAccessRequest {
  return {
    id: "request-fixture-1",
    userId: "user-fixture-1",
    displayName: "Alex Trail",
    identity: "alex@example.test",
    status: "pending",
    requestedAt: FIXTURE_ACTIVITY_START_MS,
    notificationStatus: "not_configured",
    notificationAttemptedAt: null,
    decidedAt: null,
    ...overrides,
  }
}

export function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  const user = makeServerUser(overrides)
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    handle: user.handle,
    status: user.status,
    updatedAt: FIXTURE_ACTIVITY_START_MS,
    identity: "alex@example.test",
    request: makeAccessRequest({
      userId: user.id,
      displayName: user.displayName,
    }),
    storage: {
      activityCount: 18,
      publicActivityCount: 7,
      activitySizeBytes: 4_820_000,
    },
    ...overrides,
  }
}
