import { Hono } from "hono"
import type { AccessRequest } from "~shared/api"
import { createRequireSession, type AuthEnv } from "../auth/middleware"
import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"
import { sendTelegram } from "../telegram"

function applicant(request: Awaited<ReturnType<ServerStore["getAccessRequest"]>>): AccessRequest | null {
  return request ? { status: request.status, requestedAt: request.requestedAt } : null
}

export function createAccessRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()
  const requireSession = createRequireSession(store)
  app.get("/access-request", requireSession, async (c) => c.json(applicant(await store.getAccessRequest(c.get("user").id))))
  app.post("/access-request", requireSession, async (c) => {
    const user = c.get("user")
    if (user.status !== "pending") return jsonError(c, "bad_request", "This account cannot request access.")
    const before = await store.getAccessRequest(user.id)
    const request = await store.createAccessRequest(user.id)
    if (!before) {
      const identity = await store.findPrimaryIdentity(user.id)
      const result = await sendTelegram(store, `Access request\n${user.displayName}\n${identity?.provider}:${identity?.providerLogin}\n${new Date(request.requestedAt).toISOString()}`)
      await store.setAccessRequestNotification(user.id, result)
    }
    return c.json(applicant(request), before ? 200 : 201)
  })
  return app
}
