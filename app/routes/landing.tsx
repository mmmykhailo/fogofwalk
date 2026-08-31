import type { Route } from "./+types/landing"
import { LandingPage } from "~/components/landing/LandingPage"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Fog of Walk — Make every route count" },
    {
      name: "description",
      content:
        "Turn GPX and FIT activities into a personal fog map. Explore more, keep your data on your device, and reveal every place you have been.",
    },
  ]
}

export default function LandingRoute() {
  return <LandingPage />
}
