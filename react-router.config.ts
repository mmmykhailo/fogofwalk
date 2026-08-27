import type { Config } from "@react-router/dev/config"

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: false,
  // The dark-first navigation deliberately delays the route change. Keep the
  // full route manifest available from first paint so a client-loader route
  // (notably /u/:handle) can never race lazy route discovery and leave the
  // data strategy without a loader result.
  routeDiscovery: { mode: "initial" },
} satisfies Config
