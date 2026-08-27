import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  ADMIN_LOGIN,
  API_PORT,
  API_URL,
  WEB_URL,
  WEB_URL_SERVERLESS,
} from "./fixtures/ports"

const here = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = join(here, "..")

/**
 * Boots the real sync server before any spec runs.
 *
 * A single shared server rather than one per worker: the client dev server
 * bakes `VITE_API_URL` in at startup, so every worker has to point at the same
 * API. Isolation comes from each test claiming its own login out of
 * a unique local account. Each account requests access through the app and a
 * dedicated local administrator approves it through the real admin route.
 */
export default async function globalSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), "fogofwalk-e2e-"))

  const server = spawn("bun", ["src/index.ts"], {
    cwd: join(repoRoot, "server"),
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATA_DIR: dataDir,
      STORE_DRIVER: "sqlite-fs",
      PUBLIC_URL: API_URL,
      // Both client projects must be allowed to sign in and to be redirected to.
      ALLOWED_ORIGINS: `${WEB_URL},${WEB_URL_SERVERLESS}`,
      ADMIN_LOGINS: `fake:${ADMIN_LOGIN}`,
      DEV_FAKE_AUTH: "true",
      SESSION_SECRET: "e2e-session-secret-that-is-long-enough-0123456789",
    },
  })

  await waitForHealth(`${API_URL}/health`, "sync server")

  return () => {
    server.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

async function waitForHealth(url: string, label: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${label} did not become healthy at ${url}`)
}
