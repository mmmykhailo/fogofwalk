import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  route("/", "routes/home.tsx", [
    index("routes/map-index.tsx"),
    route("help", "routes/help.tsx"),
    route("changelog", "routes/changelog.tsx"),
    route("stats", "routes/stats.tsx"),
    route("activities", "routes/activities.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("terms", "routes/terms.tsx"),
    route("auth/callback", "routes/auth-callback.tsx"),
    route("account/access-request", "routes/account.access-request.tsx"),
    route("admin", "routes/admin.tsx"),
    route("u/:handle", "routes/u.$handle.tsx"),
    route("u/:handle/achievements", "routes/u.$handle.achievements.tsx"),
    route("u/:handle/points", "routes/u.$handle.points.tsx"),
  ]),
] satisfies RouteConfig
