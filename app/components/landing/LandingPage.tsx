import { LandingFeatures } from "~/components/landing/LandingFeatures"
import { LandingFooter } from "~/components/landing/LandingFooter"
import { LandingHeader } from "~/components/landing/LandingHeader"
import { LandingHero } from "~/components/landing/LandingHero"
import { LandingRecordingGuide } from "~/components/landing/LandingRecordingGuide"
import { LandingWorkflow } from "~/components/landing/LandingWorkflow"

export function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <LandingHeader />
      <LandingHero />
      <LandingFeatures />
      <LandingWorkflow />
      <LandingRecordingGuide />
      <LandingFooter />
    </main>
  )
}
