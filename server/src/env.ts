/**
 * Typed environment. Parsed once at import time so a misconfigured deploy
 * fails at boot with a readable message instead of 500ing on the first
 * request.
 */

import { z } from "zod"

const csv = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  /**
   * Interface to bind. The default reaches the whole network, which is what a
   * container wants; behind a reverse proxy set it to 127.0.0.1 so the port is
   * unreachable from outside the box whatever the firewall says.
   */
  HOST: z.string().min(1).default("0.0.0.0"),
  DATA_DIR: z.string().min(1).default("./data"),
  STORE_DRIVER: z.string().min(1).default("sqlite-fs"),
  /** Exact client origins allowed by CORS and by the OAuth redirect guard. */
  ALLOWED_ORIGINS: z
    .string({ required_error: "ALLOWED_ORIGINS is required" })
    .min(1, "ALLOWED_ORIGINS must list at least one origin"),
  /** Deployment-owned administrator identities. */
  ADMIN_LOGINS: z.string({ required_error: "ADMIN_LOGINS is required" }).min(1),
  /** Signs the short-lived OAuth state cookie. */
  SESSION_SECRET: z
    .string({ required_error: "SESSION_SECRET is required" })
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  /** This server's externally reachable base URL — builds the redirect URI. */
  PUBLIC_URL: z
    .string({ required_error: "PUBLIC_URL is required" })
    .url("PUBLIC_URL must be an absolute URL"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
})

export interface Env {
  PORT: number
  HOST: string
  DATA_DIR: string
  STORE_DRIVER: string
  /** Normalised: no trailing slash, lowercased. */
  ALLOWED_ORIGINS: string[]
  ADMIN_LOGINS: string[]
  SESSION_SECRET: string
  /** Normalised: no trailing slash. */
  PUBLIC_URL: string
  GITHUB_CLIENT_ID: string | null
  GITHUB_CLIENT_SECRET: string | null
}

const stripTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`
    )
    throw new Error(
      `Invalid server environment:\n${lines.join("\n")}\n\n` +
        `See server/.env.example for the full list of variables.`
    )
  }

  const parsed = result.data

  // GitHub credentials are optional, but only as a pair — half a pair is a
  // typo, not a deliberate "GitHub is off".
  const hasId = Boolean(parsed.GITHUB_CLIENT_ID)
  const hasSecret = Boolean(parsed.GITHUB_CLIENT_SECRET)
  if (hasId !== hasSecret) {
    throw new Error(
      "Invalid server environment:\n" +
        "  - GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together " +
        "(or both omitted to disable GitHub sign-in)."
    )
  }

  const origins = csv(parsed.ALLOWED_ORIGINS).map((origin) =>
    stripTrailingSlash(origin).toLowerCase()
  )
  if (origins.length === 0) {
    throw new Error(
      "Invalid server environment:\n" +
        "  - ALLOWED_ORIGINS must list at least one origin"
    )
  }

  const adminLogins = csv(parsed.ADMIN_LOGINS).map((entry) =>
    entry.toLowerCase()
  )
  if (
    adminLogins.length === 0 ||
    adminLogins.some((entry) => !/^[^:\s]+:[^:\s]+$/.test(entry))
  ) {
    throw new Error(
      "Invalid server environment:\n  - ADMIN_LOGINS must contain one or more provider:login identities"
    )
  }

  return {
    PORT: parsed.PORT,
    HOST: parsed.HOST,
    DATA_DIR: parsed.DATA_DIR,
    STORE_DRIVER: parsed.STORE_DRIVER,
    ALLOWED_ORIGINS: origins,
    ADMIN_LOGINS: adminLogins,
    SESSION_SECRET: parsed.SESSION_SECRET,
    PUBLIC_URL: stripTrailingSlash(parsed.PUBLIC_URL),
    GITHUB_CLIENT_ID: parsed.GITHUB_CLIENT_ID ?? null,
    GITHUB_CLIENT_SECRET: parsed.GITHUB_CLIENT_SECRET ?? null,
  }
}

export const env: Env = parseEnv(Bun.env)
