import { useRef, useEffect } from "react"
import { PlusIcon, MinusIcon, NavigationArrowIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"
import { ButtonGroup } from "~/components/ui/button-group"
import { cn } from "~/lib/utils"
import { mapStore } from "~/lib/mapStore"

interface MapCompassProps {
  bearing: number
  pitch: number
  onReset: () => void
  className?: string
}

export function MapCompass({ bearing, onReset, className }: MapCompassProps) {
  const iconRef = useRef<SVGSVGElement>(null)
  const accumulatedRef = useRef(45 - bearing)

  useEffect(() => {
    const target = 45 - bearing
    let delta = target - accumulatedRef.current
    // Normalize to [-180, 180] — always take the shortest arc
    delta = (((delta % 360) + 540) % 360) - 180
    accumulatedRef.current += delta
    if (iconRef.current) {
      iconRef.current.style.transform = `rotate(${accumulatedRef.current}deg)`
    }
  }, [bearing])

  return (
    <ButtonGroup
      orientation="vertical"
      className={cn("bg-background/80 backdrop-blur-md", className)}
    >
      <Button
        variant="outline"
        size="icon"
        onClick={() => mapStore.map?.zoomIn()}
        title="Zoom in"
        aria-label="Zoom in"
        className="border-none bg-transparent"
      >
        <PlusIcon weight="bold" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => mapStore.map?.zoomOut()}
        title="Zoom out"
        aria-label="Zoom out"
        className="border-none bg-transparent"
      >
        <MinusIcon weight="bold" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={onReset}
        title="Reset to north"
        aria-label="Reset to north"
        className="border-none bg-transparent"
      >
        <NavigationArrowIcon
          ref={iconRef}
          weight="fill"
          className="text-red-500"
          style={{
            transform: `rotate(${45 - bearing}deg)`,
            transition: "transform 0.08s linear",
          }}
        />
      </Button>
    </ButtonGroup>
  )
}
