import path from "node:path"
import { fileURLToPath } from "node:url"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          // This plugin indexes the stories declared by .storybook/main.ts and
          // injects Storybook's project and a11y annotations into each test.
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
          }),
        ],
        resolve: {
          alias: {
            "~": path.join(dirname, "app"),
            "~shared": path.join(dirname, "shared"),
          },
        },
        test: {
          name: "storybook",
          setupFiles: path.join(dirname, ".storybook/vitest.setup.ts"),
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
})
