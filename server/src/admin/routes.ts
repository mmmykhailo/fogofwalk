import { Hono } from "hono"
import { z } from "zod"
import type { AdminBootstrapResponse } from "~shared/api"
import type { AuthEnv } from "../auth/middleware"
import { jsonError } from "../errors"
import type { ServerStore } from "../store/types"
import {
  decryptTelegramToken,
  encryptTelegramToken,
  sendTelegram,
} from "../telegram"

const uuid = z.string().uuid()
const statusBody = z.object({
  status: z.enum(["pending", "allowed", "blocked"]),
})
const decisionBody = z.object({ decision: z.enum(["approve", "reject"]) })
const settingsBody = z.object({
  chatId: z
    .string()
    .trim()
    .regex(/^-?\d{1,20}$/)
    .optional(),
  token: z.string().trim().min(1).max(512).optional(),
  clearChatId: z.boolean().optional(),
  clearToken: z.boolean().optional(),
})

async function bootstrap(store: ServerStore): Promise<AdminBootstrapResponse> {
  const [requests, users, telegramChatId, token] = await Promise.all([
    store.listAdminRequests(),
    store.listAdminUsers(),
    store.getSetting("telegram_chat_id"),
    store.getSetting("telegram_bot_token"),
  ])
  return {
    requests,
    users,
    telegramChatId,
    isBotTokenConfigured:
      token !== null && (await decryptTelegramToken(token)) !== null,
  }
}

export function createAdminRoutes(store: ServerStore) {
  const app = new Hono<AuthEnv>()
  app.get("/bootstrap", async (c) => c.json(await bootstrap(store)))
  app.patch("/requests/:id", async (c) => {
    if (!uuid.safeParse(c.req.param("id")).success)
      return jsonError(c, "not_found")
    const body = decisionBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, "bad_request", "Invalid decision.")
    const request = await store.decideAccessRequest(
      c.req.param("id"),
      body.data.decision,
      c.get("user").id
    )
    if (!request) return jsonError(c, "not_found")
    return c.json({ ok: true })
  })
  app.patch("/users/:id/status", async (c) => {
    const userId = c.req.param("id")
    if (!uuid.safeParse(userId).success) return jsonError(c, "not_found")
    const body = statusBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, "bad_request", "Invalid status.")
    if (userId === c.get("user").id && body.data.status !== "allowed")
      return jsonError(
        c,
        "bad_request",
        "Administrators cannot block themselves."
      )
    const user = await store.setUserStatus(userId, body.data.status)
    if (!user) return jsonError(c, "not_found")
    return c.json({ ok: true })
  })
  app.patch("/settings/telegram", async (c) => {
    const body = settingsBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return jsonError(c, "bad_request", "Invalid Telegram settings.")
    const adminId = c.get("user").id
    if (body.data.clearChatId)
      await store.setSetting("telegram_chat_id", null, adminId)
    else if (body.data.chatId !== undefined)
      await store.setSetting("telegram_chat_id", body.data.chatId, adminId)
    if (body.data.clearToken)
      await store.setSetting("telegram_bot_token", null, adminId)
    else if (body.data.token !== undefined)
      await store.setSetting(
        "telegram_bot_token",
        await encryptTelegramToken(body.data.token),
        adminId
      )
    return c.json(await bootstrap(store))
  })
  app.post("/settings/telegram/test", async (c) => {
    const result = await sendTelegram(
      store,
      "Fog of Walk Telegram notifications are configured."
    )
    if (result !== "sent")
      return jsonError(
        c,
        "bad_request",
        "Telegram test message could not be sent."
      )
    return c.json({ ok: true })
  })
  app.post("/requests/:id/resend-notification", async (c) => {
    const id = c.req.param("id")
    if (!uuid.safeParse(id).success) return jsonError(c, "not_found")
    const request = (await store.listAdminRequests()).find(
      (item) => item.id === id
    )
    if (!request) return jsonError(c, "not_found")
    const result = await sendTelegram(
      store,
      `Access request\n${request.displayName}\n${request.identity ?? "Unknown identity"}\n${new Date(request.requestedAt).toISOString()}`
    )
    await store.setAccessRequestNotification(request.userId, result)
    return c.json({ ok: true, notificationStatus: result })
  })
  return app
}
