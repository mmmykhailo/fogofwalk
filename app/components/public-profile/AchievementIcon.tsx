import {
  BicycleIcon,
  MountainsIcon,
  MoonStarsIcon,
  PersonSimpleRunIcon,
  PersonSimpleWalkIcon,
  QuestionIcon,
  SunHorizonIcon,
  TimerIcon,
} from "@phosphor-icons/react"
import type { EarnedAchievement } from "~/lib/achievements"

interface AchievementIconProps {
  achievement: EarnedAchievement
}

export function AchievementIcon({ achievement }: AchievementIconProps) {
  const { definition } = achievement

  if (definition.family === "duration") {
    return definition.activityTypes?.includes("cycling") ? (
      <BicycleIcon size={22} weight="duotone" />
    ) : (
      <TimerIcon size={22} weight="duotone" />
    )
  }
  if (definition.activityTypes?.includes("cycling")) {
    return <BicycleIcon size={22} weight="duotone" />
  }
  if (definition.activityTypes?.includes("walking")) {
    return <PersonSimpleWalkIcon size={22} weight="duotone" />
  }
  if (definition.activityTypes?.includes("running")) {
    return <PersonSimpleRunIcon size={22} weight="duotone" />
  }
  if (definition.id === "early-bird") {
    return <SunHorizonIcon size={22} weight="duotone" />
  }
  if (definition.id === "night-owl") {
    return <MoonStarsIcon size={22} weight="duotone" />
  }
  if (definition.family === "elevation") {
    return <MountainsIcon size={22} weight="duotone" />
  }
  return <QuestionIcon size={22} weight="duotone" />
}
