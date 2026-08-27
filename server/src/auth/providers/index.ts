/**
 * Provider registry, built from whatever credentials the environment carries.
 * A provider with no credentials simply is not listed by
 * `GET /api/auth/providers` and 404s on `/start` — that is how a deployment
 * turns sign-in methods on and off without a code change.
 */

import type { AuthProviderInfo } from "~shared/api"

import { env } from "../../env"
import { createGitHubProvider } from "./github"
import type { OAuthProvider } from "./types"

export type { OAuthProfile, OAuthProvider } from "./types"

/** `PUBLIC_URL` is this server's own externally reachable base URL. */
export function redirectUriFor(providerId: string): string {
  return `${env.PUBLIC_URL}/api/auth/${providerId}/callback`
}

function buildRegistry(): Record<string, OAuthProvider> {
  const registry: Record<string, OAuthProvider> = {}

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    registry.github = createGitHubProvider(
      env.GITHUB_CLIENT_ID,
      env.GITHUB_CLIENT_SECRET,
      redirectUriFor("github")
    )
  }

  // Fake accounts are deliberately handled by the local route rather than an
  // OAuth adapter: no provider redirect or credentials are involved.
  if (env.DEV_FAKE_AUTH) {
    registry.fake = {
      id: "fake",
      label: "Test user (local)",
      createAuthUrl: () => new URL(`${env.PUBLIC_URL}/api/auth/fake/start`),
      exchange: async () => {
        throw new Error("The fake provider does not exchange OAuth codes.")
      },
    }
  }

  // Add a provider here: `registry.google = createGoogleProvider(...)`.

  return registry
}

export const providers: Record<string, OAuthProvider> = buildRegistry()

export function listProviders(): AuthProviderInfo[] {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    label: provider.label,
  }))
}
