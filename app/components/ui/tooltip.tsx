import * as React from "react"

import { cn } from "~/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

function Tooltip({ ...props }: React.ComponentProps<typeof Popover>) {
  return <Popover data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof PopoverTrigger>) {
  return <PopoverTrigger data-slot="tooltip-trigger" openOnHover {...props} />
}

function TooltipContent({
  className,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      data-slot="tooltip-content"
      side="top"
      className={cn(
        "w-fit max-w-xs bg-foreground px-3 py-1.5 text-xs text-background ring-0",
        className
      )}
      {...props}
    />
  )
}

function TooltipProvider({ children }: React.PropsWithChildren) {
  return <>{children}</>
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
