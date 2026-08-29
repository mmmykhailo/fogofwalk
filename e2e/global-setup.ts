import { spawn, type ChildProcess } from "node:child_process"
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
  // A killed Playwright parent can leave its sync-server child behind. Do not
  // mistake that stale process (and its old database) for the server below:
  // tests would then sign in and download data from an earlier run.
  await assertServerIsNotAlreadyRunning(`${API_URL}/health`, "sync server")
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

  try {
    await waitForHealth(`${API_URL}/health`, "sync server", server)
  } catch (error) {
    server.kill()
    rmSync(dataDir, { recursive: true, force: true })
    throw error
  }

  return () => {
    server.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

async function assertServerIsNotAlreadyRunning(url: string, label: string) {
  try {
    const res = await fetch(url)
    if (res.ok) {
      throw new Error(
        `${label} is already running at ${url}; stop the stale E2E process and retry`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("already running")) {
      throw error
    }
    // A refused connection is the expected clean-start state.
  }
}

async function waitForHealth(url: string, label: string, server: ChildProcess) {
  const deadline = Date.now() + 20_000
  let exitFailure: Error | null = null
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitFailure = new Error(
      `${label} exited before becoming healthy (${signal ?? `code ${code}`})`
    )
  }
  server.once("exit", onExit)

  try {
    while (Date.now() < deadline) {
      if (exitFailure) throw exitFailure
      try {
        const res = await fetch(url)
        if (res.ok) {
          // Give a competing bind a moment to surface before accepting health.
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (exitFailure) throw exitFailure
          return
        }
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(`${label} did not become healthy at ${url}`)
  } finally {
    server.off("exit", onExit)
  }
}
