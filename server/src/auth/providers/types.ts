/**
 * The OAuth seam. Adding Google/Strava later is one file plus one registry
 * line plus two env vars — no route or middleware change. The step-by-step is
 * under "Adding another OAuth provider" in `server/README.md`.
 */

export interface OAuthProfile {
  providerUserId: string
  /** Stable handle used by the `ALLOWED_LOGINS` allowlist, e.g. a username. */
  login: string
  displayName: string
  avatarUrl: string | null
  email: string | null
}

export interface OAuthProvider {
  /** URL segment: `/api/auth/<id>/start`. */
  id: string
  /** Human label for the sign-in dialog. */
  label: string
  /**
   * `verifier` is the PKCE code verifier. Providers that do not implement PKCE
   * (GitHub is one) ignore it; it is still minted and stored so a PKCE
   * provider can be added without touching the routes.
   */
  createAuthUrl(state: string, verifier: string): URL
  exchange(code: string, verifier: string): Promise<OAuthProfile>
}
