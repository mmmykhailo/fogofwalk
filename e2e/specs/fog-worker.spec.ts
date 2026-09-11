import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/app"
import { makeGpx } from "../fixtures/gpx"

const PROTOCOL_VERSION = 2
const ALGORITHM_VERSION = 3
const PARTITION_SCHEME_VERSION = 3

const baseActivity = {
  id: "good",
  name: "good route",
  coordinates: [
    [13.5, 52.5],
    [13.51, 52.51],
  ],
}

const resetRequest = {
  protocolVersion: PROTOCOL_VERSION,
  requestId: "reset-1",
  generation: 1,
  libraryRevision: 1,
  mode: "corridor",
  kind: "cancel",
  activities: [],
}

interface BrowserWatchdogModule {
  createFogWorkerWatchdog: (options: {
    timeoutMs: number
    stageTimeoutMs?: { aggregating?: number }
    now: () => number
    onTimeout: (request: {
      requestId: string
      generation: number
      stage?: "buffering" | "aggregating" | "complete"
    }) => void
  }) => {
    observe: (request: {
      requestId: string
      generation: number
      stage?: "buffering" | "aggregating" | "complete"
    }) => void
    check: (now?: number) => boolean
  }
}

async function openApp(page: Page) {
  await page.goto("/")
}

test("[F-039] stamps the current fog identity through a real worker", async ({
  page,
}) => {
  await openApp(page)

  const snapshot = await page.evaluate(
    async ({ reset, protocolVersion }) => {
      const worker = new Worker("/app/workers/fogWorker.ts", {
        type: "module",
      })
      const processRequest = {
        protocolVersion,
        requestId: "rebuild-1",
        generation: 1,
        libraryRevision: 1,
        mode: "corridor",
        kind: "rebuild",
        activities: [
          {
            id: "good",
            name: "good route",
            coordinates: [
              [13.5, 52.5],
              [13.51, 52.51],
            ],
          },
        ],
      }

      return new Promise<unknown>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          worker.terminate()
          reject(new Error("fog worker did not finish the rebuild"))
        }, 15_000)
        worker.onmessage = (event) => {
          if (
            event.data?.type === "DONE" &&
            event.data.requestId === processRequest.requestId
          ) {
            window.clearTimeout(timer)
            worker.terminate()
            resolve(event.data.snapshot)
          }
        }
        worker.onerror = (event) => {
          window.clearTimeout(timer)
          worker.terminate()
          reject(new Error(event.message || "fog worker failed"))
        }
        worker.postMessage(reset)
        worker.postMessage(processRequest)
      })
    },
    { reset: resetRequest, protocolVersion: PROTOCOL_VERSION }
  )

  expect(snapshot).toMatchObject({
    generation: 1,
    libraryRevision: 1,
    mode: "corridor",
    algorithmVersion: ALGORITHM_VERSION,
    partitionSchemeVersion: PARTITION_SCHEME_VERSION,
    completeness: "complete",
  })
})

test("[F-039] persists only a complete current fog cache", async ({ app }) => {
  await app.goto()
  await app.importFiles([makeGpx("fog-cache-version.gpx", 1)])
  await app.waitForImportToSettle()

  await expect
    .poll(() => app.fogCacheSummary(), { timeout: 15_000 })
    .toMatchObject({
      algorithmVersion: ALGORITHM_VERSION,
      partitionSchemeVersion: PARTITION_SCHEME_VERSION,
      completeness: "complete",
    })
})

test("[F-040] keeps a rejected rebuild partial and blocks append-after-partial", async ({
  page,
}) => {
  await openApp(page)

  const result = await page.evaluate(
    async ({ reset, protocolVersion }) => {
      const worker = new Worker("/app/workers/fogWorker.ts", {
        type: "module",
      })
      const rebuildRequest = {
        protocolVersion,
        requestId: "rebuild-partial",
        generation: 1,
        libraryRevision: 1,
        mode: "corridor",
        kind: "rebuild",
        activities: [
          {
            id: "good",
            name: "good route",
            coordinates: [
              [13.5, 52.5],
              [13.51, 52.51],
            ],
          },
          { id: "bad", name: "rejected route", coordinates: [] },
        ],
      }
      const appendRequest = {
        protocolVersion,
        requestId: "append-after-partial",
        generation: 1,
        libraryRevision: 2,
        baseLibraryRevision: 1,
        mode: "corridor",
        kind: "append",
        activities: [
          {
            id: "new",
            name: "new route",
            coordinates: [
              [13.52, 52.52],
              [13.53, 52.53],
            ],
          },
        ],
      }

      return new Promise<{
        partial: unknown
        appendDone: unknown
        errors: unknown[]
      }>((resolve, reject) => {
        const errors: unknown[] = []
        let partial: unknown
        const timer = window.setTimeout(() => {
          worker.terminate()
          reject(new Error("fog worker did not finish the partial scenario"))
        }, 15_000)
        worker.onmessage = (event) => {
          const message = event.data
          if (message?.type === "ERROR") errors.push(message)
          if (
            message?.type === "DONE" &&
            message.requestId === rebuildRequest.requestId
          ) {
            partial = message.snapshot
            worker.postMessage(appendRequest)
          }
          if (
            message?.type === "DONE" &&
            message.requestId === appendRequest.requestId
          ) {
            window.clearTimeout(timer)
            worker.terminate()
            resolve({ partial, appendDone: message.snapshot, errors })
          }
        }
        worker.onerror = (event) => {
          window.clearTimeout(timer)
          worker.terminate()
          reject(new Error(event.message || "fog worker failed"))
        }
        worker.postMessage(reset)
        worker.postMessage(rebuildRequest)
      })
    },
    { reset: resetRequest, protocolVersion: PROTOCOL_VERSION }
  )

  expect(result.partial).toMatchObject({
    completeness: "partial",
    diagnostics: { rejectedActivityCount: 1 },
  })
  expect(result.appendDone).toBeNull()
  expect(result.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fatal: true,
        message: expect.stringContaining("current base is partial"),
      }),
    ])
  )
})

test("[F-041] refreshes the watchdog deadline from browser progress", async ({
  page,
}) => {
  await openApp(page)

  const checks = await page.evaluate(async () => {
    const watchdogModuleUrl = "/app/lib/fog/watchdog.ts"
    const { createFogWorkerWatchdog } = (await import(
      /* @vite-ignore */ watchdogModuleUrl
    )) as BrowserWatchdogModule
    let clock = 0
    const timedOut: string[] = []
    const watchdog = createFogWorkerWatchdog({
      timeoutMs: 10,
      stageTimeoutMs: { aggregating: 30 },
      now: () => clock,
      onTimeout: ({ requestId }) => timedOut.push(requestId),
    })

    watchdog.observe({
      requestId: "active",
      generation: 1,
      stage: "buffering",
    })
    clock = 9
    watchdog.observe({
      requestId: "active",
      generation: 1,
      stage: "aggregating",
    })
    return {
      beforeDeadline: watchdog.check(38),
      atDeadline: watchdog.check(39),
      timedOut,
    }
  })

  expect(checks).toEqual({
    beforeDeadline: false,
    atDeadline: true,
    timedOut: ["active"],
  })
})
