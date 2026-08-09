/**
 * The client half of the upload rate limit.
 *
 * The server's real limit is 120 uploads a minute, which is far more than a
 * spec should have to produce — and the rig boots a single shared server, so
 * lowering it would slow every other spec. The 429 is synthesised per-request
 * instead: what is under test is what the *client* does with one.
 */

import { test, expect } from "../fixtures/app"
import { API_URL, WEB_URL } from "../fixtures/ports"
import type { Page } from "@playwright/test"

const RATE_LIMITED_BODY = JSON.stringify({
  error: "rate_limited",
  message: "Too many uploads. Try again shortly.",
  retryAfterMs: 300,
})

/**
 * Answers uploads with a 429.
 *
 * `always` keeps rejecting; otherwise only the first attempt per content hash
 * is rejected and the retry is passed through to the real server.
 *
 * The `Access-Control-Allow-Origin` header is not optional: the API is
 * cross-origin, so without it the browser discards the synthetic response and
 * the client sees a network error rather than the 429 under test. That the wait
 * still arrives — carried in the body, with no `Access-Control-Expose-Headers`
 * anywhere — is the reason `retryAfterMs` is not a `Retry-After` header alone.
 */
async function rejectUploads(
  page: Page,
  options: { always?: boolean } = {}
): Promise<Set<string>> {
  const rejected = new Set<string>()

  await page.route(`${API_URL}/api/tracks/*`, async (route) => {
    const request = route.request()
    if (request.method() !== "PUT") return route.fallback()

    const hash = request.url().split("/").pop() ?? ""
    if (!options.always && rejected.has(hash)) return route.fallback()
    rejected.add(hash)

    return route.fulfill({
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": WEB_URL,
        "Retry-After": "1",
      },
      body: RATE_LIMITED_BODY,
    })
  })

  return rejected
}

test.describe("upload rate limiting", () => {
  /**
   * Before the retry existed, `pooled` counted a 429 as a failed item and moved
   * on, so a rate-limited track waited for a later sync trigger — up to five
   * minutes — to be attempted again.
   *
   * Nothing here nudges sync: the import's own `add-files` run has to finish the
   * job on its own. Calling `syncNow` would be a *second* run, and a second run
   * uploads these tracks whether or not the first one retried — which is exactly
   * the bug, so it would make the test pass against the code it is meant to fail.
   */
  test("a 429 is retried within the same sync", async ({
    app,
    serverState,
  }) => {
    const rejected = await rejectUploads(app.page)

    await app.goto()
    await app.signIn()
    await app.importTracks(3)
    await app.waitForImportToSettle()

    await expect
      .poll(async () => (await serverState(app.page)).tracks.length, {
        timeout: 30_000,
      })
      .toBe(3)

    // Every track really did hit the limit — otherwise this passes vacuously.
    expect(rejected.size).toBe(3)

    const state = await serverState(app.page)
    expect(state.tracks.map((t) => t.name).sort()).toEqual([
      "t1.gpx",
      "t2.gpx",
      "t3.gpx",
    ])

    // And the retry is not left showing a failure the user has to act on.
    expect(await app.accountRowDescription()).not.toContain("couldn't")
  })

  /**
   * The other half of the same guarantee: retrying is bounded. A server that
   * keeps saying no must end the run and report it, not park sync forever.
   */
  test("uploads that stay rate-limited give up and report it", async ({
    app,
    serverState,
  }) => {
    await rejectUploads(app.page, { always: true })

    await app.goto()
    await app.signIn()
    await app.importTracks(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    expect((await serverState(app.page)).tracks).toHaveLength(0)
    expect(await app.accountRowDescription()).toContain(
      "Some tracks couldn't be uploaded"
    )
  })
})
