import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "app",
      filename: "sw.ts",
      // SW registration is handled manually in root.tsx (React Router generates HTML
      // after Vite plugin hooks, so the automatic inline injection doesn't reach index.html)
      injectRegister: null,
      // We manage site.webmanifest ourselves
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["sample-run.gpx"],
      },
    }),
  ],
  worker: {
    format: "es",
    plugins: () => [tsconfigPaths()],
  },
  // Playwright starts two Vite instances (synced and serverless). The E2E suite
  // never needs HMR, and watching the independent server and test packages in
  // both instances can exhaust the OS file-watch limit before the tests start.
  server:
    process.env.E2E === "1"
      ? {
          watch: {
            ignored: ["**/e2e/**", "**/server/**", "**/.git/**"],
          },
        }
      : undefined,
})
