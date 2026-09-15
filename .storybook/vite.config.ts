import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tailwindcss(), tsconfigPaths()],
  // Storybook is an isolated, serverless preview. Do not let a developer's
  // local .env turn component stories into API clients.
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
})
