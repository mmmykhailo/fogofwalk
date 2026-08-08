/**
 * The Hono app, as a factory over the store so tests can run the real routes
 * against the `memory` driver with `app.request(...)` and no socket.
 */

import { Hono } from "hono"
import { cors } from "hono/cors"

import { createAccountRoutes } from "./account/routes"
import { createAuthRoutes } from "./auth/routes"
import { env } from "./env"
import { HttpError, errorBody, statusFor } from "./errors"
import type { ServerStore } from "./store/types"
import { createTrackRoutes } from "./tracks/routes"

export function createApp(store: ServerStore) {
  const app = new Hono()

  app.use(
    "*",
    cors({
      // Explicit list, never "*": the API is cross-origin to the client, and
      // a wildcard would let any page read a signed-in user's tracks.
      origin: env.ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "Content-Encoding"],
      // The bearer token travels in a header, so no cookie ever needs to
      // cross origins.
      credentials: false,
      maxAge: 86400,
    })
  )

  app.get("/health", (c) => c.json({ ok: true }))

  app.route("/api/auth", createAuthRoutes(store))
  app.route("/api", createAccountRoutes(store))
  app.route("/api/tracks", createTrackRoutes(store))

  app.notFound((c) => c.json(errorBody("not_found"), 404))

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(errorBody(error.code, error.message), statusFor(error.code))
    }
    console.error("unhandled error:", error)
    return c.json(errorBody("server_error"), 500)
  })

  return app
}

export type App = ReturnType<typeof createApp>
