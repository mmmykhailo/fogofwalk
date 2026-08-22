import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  route("/", "routes/home.tsx", [
    index("routes/map-index.tsx"),
    route("help", "routes/help.tsx"),
    route("stats", "routes/stats.tsx"),
    route("tracks", "routes/tracks.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("terms", "routes/terms.tsx"),
    route("auth/callback", "routes/auth-callback.tsx"),
    route("u/:handle", "routes/u.$handle.tsx"),
  ]),
] satisfies RouteConfig
