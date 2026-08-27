/**
 * Entry point. `export default { fetch, port }` is what Bun.serve consumes —
 * there is no adapter, no build step and no Node compatibility layer.
 */

import { createApp } from "./app"
import { env } from "./env"
import { listProviders } from "./auth/providers"
import { createStore } from "./store"

const store = await createStore()
const app = createApp(store)

const enabled = listProviders().map((provider) => provider.id)
console.log(
  `fogofwalk-server on ${env.HOST}:${env.PORT} — driver ${env.STORE_DRIVER}, ` +
    `origins ${env.ALLOWED_ORIGINS.join(", ")}, ` +
    `providers ${enabled.length > 0 ? enabled.join(", ") : "(none configured)"}`
)

export default {
  fetch: app.fetch,
  port: env.PORT,
  hostname: env.HOST,
}
