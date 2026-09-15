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
  optimizeDeps: {
    include: [
      "@base-ui/react/checkbox",
      "@base-ui/react/dialog",
      "@base-ui/react/merge-props",
      "@base-ui/react/popover",
      "@base-ui/react/select",
      "@base-ui/react/separator",
      "@base-ui/react/switch",
      "@base-ui/react/use-render",
      "@phosphor-icons/react",
      "@storybook/addon-docs",
      "@storybook/react-dom-shim",
      "recharts",
      "vaul",
    ],
  },
  // Storybook is an isolated, serverless preview. Do not let a developer's
  // local .env turn component stories into API clients.
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
})
