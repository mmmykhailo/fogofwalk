import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("/help", "routes/help.tsx"),
  route("/stats", "routes/stats.tsx"),
  route("/privacy", "routes/privacy.tsx"),
  route("/terms", "routes/terms.tsx"),
  route("/auth/callback", "routes/auth-callback.tsx"),
] satisfies RouteConfig
