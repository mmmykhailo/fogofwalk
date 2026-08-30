/**
 * OAuth request entropy. These values are URL-safe and produced with Bun's
 * Web Crypto implementation, so the server does not need an OAuth helper
 * package merely to create them.
 */

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)

  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** CSRF token for the authorization request. */
export function generateOAuthState(): string {
  return randomUrlSafeString(32)
}

/**
 * PKCE verifier for providers that support it. 32 random bytes encode to 43
 * URL-safe characters, the minimum length RFC 7636 permits.
 */
export function generateCodeVerifier(): string {
  return randomUrlSafeString(32)
}
