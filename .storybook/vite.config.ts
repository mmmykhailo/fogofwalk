import path from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const storybookDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(storybookDir, "..")

export default defineConfig({
  root: projectRoot,
  plugins: [tailwindcss(), tsconfigPaths({ root: projectRoot })],
  // Storybook is an isolated, serverless preview. Do not let a developer's
  // local .env turn component stories into API clients.
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
})
