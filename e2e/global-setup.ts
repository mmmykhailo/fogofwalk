import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  ALLOWED_LOGIN_POOL,
  API_PORT,
  API_URL,
  IDP_PORT,
  IDP_URL,
  WEB_URL,
  WEB_URL_SERVERLESS,
} from "./fixtures/ports"

const here = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = join(here, "..")

/**
 * Boots the fake IdP and the real sync server before any spec runs.
 *
 * A single shared server rather than one per worker: the client dev server
 * bakes `VITE_API_URL` in at startup, so every worker has to point at the same
 * API. Isolation comes from each test claiming its own login out of
 * `ALLOWED_LOGIN_POOL` — every store method is scoped by user id, so two tests
 * cannot see each other's data.
 */
export default async function globalSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), "fogofwalk-e2e-"))

  const idp = spawn("bun", [join(here, "fixtures", "fake-idp.ts")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, IDP_PORT: String(IDP_PORT) },
  })

  const server = spawn(
    "bun",
    ["--preload", join(here, "fixtures", "stub-github.ts"), "src/index.ts"],
    {
      cwd: join(repoRoot, "server"),
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_IDP_URL: IDP_URL,
        PORT: String(API_PORT),
        DATA_DIR: dataDir,
        STORE_DRIVER: "sqlite-fs",
        PUBLIC_URL: API_URL,
        // Both client projects must be allowed to sign in and to be redirected to.
        ALLOWED_ORIGINS: `${WEB_URL},${WEB_URL_SERVERLESS}`,
        ALLOWED_LOGINS: ALLOWED_LOGIN_POOL.map((l) => `github:${l}`).join(","),
        SESSION_SECRET: "e2e-session-secret-that-is-long-enough-0123456789",
        GITHUB_CLIENT_ID: "e2e-client-id",
        GITHUB_CLIENT_SECRET: "e2e-client-secret",
      },
    }
  )

  await waitForHealth(`${IDP_URL}/health`, "fake IdP")
  await waitForHealth(`${API_URL}/health`, "sync server")

  return () => {
    server.kill()
    idp.kill()
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
