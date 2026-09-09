import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./specs",
  testMatch: /activities-performance\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-gpu-sandbox",
      ],
    },
  },
  webServer: {
    command:
      "bun run build && PORT=4173 node e2e/fixtures/serve-static.mjs",
    cwd: "..",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_URL: "",
      VITE_E2E: "1",
    },
  },
})
