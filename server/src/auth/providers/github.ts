/**
 * GitHub OAuth using GitHub's OAuth 2.0 endpoints directly. GitHub OAuth Apps
 * do not support PKCE, so the verifier this module receives is deliberately
 * unused.
 */

import type { OAuthProfile, OAuthProvider } from "./types"

const USER_AGENT = "fogofwalk-server"
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
const TOKEN_URL = "https://github.com/login/oauth/access_token"

interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
  email: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

interface GitHubTokenResponse {
  access_token?: string
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

export function createGitHubProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string
): OAuthProvider {
  return {
    id: "github",
    label: "GitHub",

    createAuthUrl(state: string): URL {
      // `read:user` is enough for id/login/name/avatar; `user:email` only adds
      // the private primary address, and the flow tolerates it being absent.
      const url = new URL(AUTHORIZE_URL)
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
      }).toString()
      return url
    },

    async exchange(code: string): Promise<OAuthProfile> {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
      if (!response.ok) {
        throw new Error(`GitHub token exchange failed: ${response.status}`)
      }

      const { access_token: accessToken } =
        (await response.json()) as GitHubTokenResponse
      if (!accessToken)
        throw new Error("GitHub token exchange returned no token.")

      const user = await githubApi<GitHubUser>("/user", accessToken)

      let email = user.email
      if (!email) {
        // Best effort: the token may not carry `user:email`, and a user can
        // have no verified address at all. Never fail sign-in over this.
        try {
          const emails = await githubApi<GitHubEmail[]>(
            "/user/emails",
            accessToken
          )
          email =
            emails.find((entry) => entry.primary && entry.verified)?.email ??
            emails.find((entry) => entry.verified)?.email ??
            null
        } catch {
          email = null
        }
      }

      return {
        providerUserId: String(user.id),
        login: user.login,
        displayName: user.name || user.login,
        avatarUrl: user.avatar_url,
        email,
      }
    },
  }
}
