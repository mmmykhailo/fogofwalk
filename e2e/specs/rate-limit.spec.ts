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
import { makeGpxSet } from "../fixtures/gpx"
import { UPLOAD_RATE_CLIENT_BUDGET } from "../../shared/constants"
import type { Page } from "@playwright/test"

/** The one line both account surfaces render while uploads are held. */
const HOLD_NOTICE = /Upload limit reached — resuming in \d+s/

const rateLimitedBody = (retryAfterMs: number) =>
  JSON.stringify({
    error: "rate_limited",
    message: "Too many uploads. Try again shortly.",
    retryAfterMs,
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
  options: { always?: boolean; retryAfterMs?: number } = {}
): Promise<Set<string>> {
  const rejected = new Set<string>()
  const retryAfterMs = options.retryAfterMs ?? 300

  await page.route(`${API_URL}/api/activities/*`, async (route) => {
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
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
      body: rateLimitedBody(retryAfterMs),
    })
  })

  return rejected
}

test.describe("upload rate limiting", () => {
  /**
   * Before the retry existed, `pooled` counted a 429 as a failed item and moved
   * on, so a rate-limited activity waited for a later sync trigger — up to five
   * minutes — to be attempted again.
   *
   * Nothing here nudges sync: the import's own `add-files` run has to finish the
   * job on its own. Calling `syncNow` would be a *second* run, and a second run
   * uploads these activities whether or not the first one retried — which is exactly
   * the bug, so it would make the test pass against the code it is meant to fail.
   */
  test("a 429 is retried within the same sync", async ({
    app,
    serverState,
  }) => {
    const rejected = await rejectUploads(app.page)

    await app.goto()
    await app.signIn()
    await app.importActivities(3)
    await app.waitForImportToSettle()

    await expect
      .poll(async () => (await serverState(app.page)).activities.length, {
        timeout: 30_000,
      })
      .toBe(3)

    // Every activity really did hit the limit — otherwise this passes vacuously.
    expect(rejected.size).toBe(3)

    const state = await serverState(app.page)
    expect(state.activities.map((t) => t.name).sort()).toEqual([
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
    await app.importActivities(1)
    await app.waitForImportToSettle()
    await app.syncNow()

    expect((await serverState(app.page)).activities).toHaveLength(0)
    expect(await app.accountRowDescription()).toContain(
      "Some activities couldn't be uploaded"
    )
  })

  /**
   * A hold of up to a minute with no explanation reads as a hang, so both
   * account surfaces say what is happening and count down.
   *
   * A long `retryAfterMs` so the wait is observable — at the 300 ms the other
   * specs use, the dialog cannot be opened before it is over.
   */
  test("the account surfaces explain the hold and count down", async ({
    app,
  }) => {
    await rejectUploads(app.page, { always: true, retryAfterMs: 20_000 })

    await app.goto()
    await app.signIn()
    await app.importActivities(1)

    // The drawer row says it too, not just the dialog behind it.
    await expect
      .poll(() => app.accountRowDescription(), { timeout: 30_000 })
      .toMatch(HOLD_NOTICE)

    // The import's own sync run is what trips the limit; don't nudge it.
    const dialog = await app.openAccountDialog()
    const status = dialog.getByTestId("sync-status")
    await expect(status).toContainText(HOLD_NOTICE, { timeout: 30_000 })

    // It counts down rather than showing one frozen number.
    const secondsOf = async () =>
      Number(/resuming in (\d+)s/.exec((await status.textContent()) ?? "")?.[1])
    const first = await secondsOf()
    await expect.poll(secondsOf, { timeout: 10_000 }).toBeLessThan(first)

    // And it wraps rather than being clipped or pushed past the dialog edge.
    // Checked at phone width, where the notice is far wider than the column —
    // at desktop width it happens to fit on one line and proves nothing.
    await app.page.setViewportSize({ width: 380, height: 800 })
    await expect(status).toContainText(HOLD_NOTICE)

    const isClipped = await status.evaluate(
      (el) => el.scrollWidth > el.clientWidth
    )
    expect(isClipped).toBe(false)

    const dialogBox = await dialog.boundingBox()
    const statusBox = await status.boundingBox()
    if (!dialogBox || !statusBox) throw new Error("dialog is not laid out")
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width
    )
  })

  /**
   * The hold users actually hit, and the one the first version missed.
   *
   * No synthetic 429 anywhere here: a fresh page spends its whole client budget
   * in one burst and then has to wait out the window, so the very first sync of
   * a large library stalls for nearly a minute without the server ever saying
   * no. Reporting only on a 429 left that minute showing "Syncing 108 of 195…"
   * — the one number that cannot move — and the notice appeared only after a
   * reload, when the client's fresh budget finally collided with the server's.
   */
  test("self-paced holds are announced too, with no 429 involved", async ({
    app,
  }) => {
    let rejections = 0
    await app.page.route(`${API_URL}/api/activities/*`, async (route) => {
      const response = await route.fetch()
      if (response.status() === 429) rejections++
      return route.fulfill({ response })
    })

    await app.goto()
    await app.signIn()
    await app.importFiles(makeGpxSet(UPLOAD_RATE_CLIENT_BUDGET + 2))

    await expect
      .poll(() => app.accountRowDescription(), { timeout: 120_000 })
      .toMatch(HOLD_NOTICE)

    // The client stayed inside the server's budget the whole time; this hold is
    // its own pacing, not a rejection it recovered from.
    expect(rejections).toBe(0)
  })
})
