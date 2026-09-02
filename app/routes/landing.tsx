import type { Route } from "./+types/landing"
import { replace } from "react-router"
import { LandingPage } from "~/components/landing/LandingPage"

function isStandalonePwa() {
  if (typeof window === "undefined") return false

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  )
}

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

export function clientLoader() {
  if (isStandalonePwa()) {
    return replace("/map")
  }

  return null
}

export default function LandingRoute() {
  return <LandingPage />
}
