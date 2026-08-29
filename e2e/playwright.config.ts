import { defineConfig, devices } from "@playwright/test"

import {
  API_URL,
  WEB_PORT,
  WEB_PORT_SERVERLESS,
  WEB_URL,
  WEB_URL_SERVERLESS,
} from "./fixtures/ports"

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // Sync is inherently timing-sensitive; give a run room without hiding hangs.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  /**
   * Deliberately modest. Every worker drives a full browser through one shared
   * Vite dev server, and each test loads the page several times; at the default
   * worker count the dev server becomes the bottleneck and tests fail on page
   * load rather than on anything they are actually asserting.
   */
  workers: process.env.CI ? 2 : Number(process.env.E2E_WORKERS ?? 4),
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    // MapLibre needs WebGL; headless Chromium only has SwiftShader. Without
    // these the Map constructor throws and *nothing* in the app is reachable,
    // because every control is gated behind the map's `load` event.
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-gpu-sandbox",
      ],
    },
  },

  projects: [
    {
      name: "synced",
      testIgnore: /serverless\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: WEB_URL },
    },
    {
      name: "serverless",
      testMatch: /serverless\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: WEB_URL_SERVERLESS },
    },
  ],

  webServer: [
    {
      // The real client, pointed at the test API.
      command: `bun run dev --port ${WEB_PORT} --strictPort`,
      cwd: "..",
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CHOKIDAR_USEPOLLING: "true",
        E2E: "1",
        VITE_API_URL: API_URL,
        VITE_E2E: "1",
      },
    },
    {
      // The same client with no server configured — the GitHub Pages build.
      command: `bun run dev --port ${WEB_PORT_SERVERLESS} --strictPort`,
      cwd: "..",
      url: WEB_URL_SERVERLESS,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CHOKIDAR_USEPOLLING: "true",
        E2E: "1",
        VITE_API_URL: "",
        VITE_E2E: "1",
      },
    },
  ],
})
