/**
 * The allowlist may only ever *promote*, and only from `pending`. Everything
 * else — demotion, resurrecting a blocked account — has to come from the
 * database, so an admin can change it without a redeploy and an env edit can
 * never hand sync back to somebody who was blocked.
 */

import { describe, expect, test } from "bun:test"

import { applyAllowlist } from "../src/auth/routes"
import { MemoryStore } from "../src/store/memory"

async function makeUser(store: MemoryStore, login: string) {
  return store.upsertUserFromIdentity({
    provider: "github",
    providerUserId: login,
    login,
    displayName: login,
    avatarUrl: null,
    email: null,
  })
}

describe("applyAllowlist", () => {
  test("promotes a pending user who is listed", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "allowed-user")
    expect(user.status).toBe("pending")

    await applyAllowlist(store, user.id, user.status, "github", "allowed-user")
    expect((await store.getUser(user.id))?.status).toBe("allowed")
  })

  test("is case-insensitive on the login", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "Allowed-User")
    await applyAllowlist(store, user.id, user.status, "github", "Allowed-User")
    expect((await store.getUser(user.id))?.status).toBe("allowed")
  })

  test("leaves an unlisted user pending", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "stranger")
    await applyAllowlist(store, user.id, user.status, "github", "stranger")
    expect((await store.getUser(user.id))?.status).toBe("pending")
  })

  test("never resurrects a blocked user, even if listed", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "allowed-user")
    await store.setUserStatus(user.id, "blocked")

    await applyAllowlist(store, user.id, "blocked", "github", "allowed-user")
    expect((await store.getUser(user.id))?.status).toBe("blocked")
  })

  test("never demotes an allowed user who is no longer listed", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "stranger")
    await store.setUserStatus(user.id, "allowed")

    await applyAllowlist(store, user.id, "allowed", "github", "stranger")
    expect((await store.getUser(user.id))?.status).toBe("allowed")
  })

  test("does not match a login from another provider", async () => {
    const store = new MemoryStore()
    const user = await makeUser(store, "allowed-user")
    await applyAllowlist(store, user.id, user.status, "google", "allowed-user")
    expect((await store.getUser(user.id))?.status).toBe("pending")
  })
})
