import type { ComponentProps } from "react"
import { cn } from "~/lib/utils"

type GridColumnCount = 1 | 2 | 3 | 4 | 5 | 6
type GridBreakpoint = "base" | "sm" | "md" | "lg" | "xl"

export type GridColumns = Partial<Record<GridBreakpoint, GridColumnCount>>

interface GridProps extends ComponentProps<"div"> {
  /** Column count at each breakpoint. Omitted breakpoints inherit the previous count. */
  columns?: GridColumns
  /** Tailwind gap scale, applied consistently across section grids. */
  gap?: 2 | 3 | 4 | 5 | 6 | 8
}

const columnClasses: Record<GridBreakpoint, Record<GridColumnCount, string>> = {
  base: {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  },
  sm: {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
    5: "sm:grid-cols-5",
    6: "sm:grid-cols-6",
  },
  md: {
    1: "md:grid-cols-1",
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-4",
    5: "md:grid-cols-5",
    6: "md:grid-cols-6",
  },
  lg: {
    1: "lg:grid-cols-1",
    2: "lg:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "lg:grid-cols-5",
    6: "lg:grid-cols-6",
  },
  xl: {
    1: "xl:grid-cols-1",
    2: "xl:grid-cols-2",
    3: "xl:grid-cols-3",
    4: "xl:grid-cols-4",
    5: "xl:grid-cols-5",
    6: "xl:grid-cols-6",
  },
}

const gapClasses: Record<NonNullable<GridProps["gap"]>, string> = {
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
}

export function Grid({
  className,
  columns = { base: 1 },
  gap = 4,
  ...props
}: GridProps) {
  return (
    <div
      data-slot="grid"
      className={cn(
        "grid",
        gapClasses[gap],
        ...Object.entries(columns).map(
          ([breakpoint, count]) =>
            columnClasses[breakpoint as GridBreakpoint][count]
        ),
        className
      )}
      {...props}
    />
  )
}
