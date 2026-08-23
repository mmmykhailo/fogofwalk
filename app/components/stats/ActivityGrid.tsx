// ─── Activity grid (last 12 weeks) ───────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const DOW_LABELS = ["M", "", "W", "", "F", "", ""]

interface ActivityGridProps {
  recentDays: string[]
}

export function ActivityGrid({ recentDays }: ActivityGridProps) {
  const activeDaySet = new Set(recentDays)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Monday of the current week
  const dow = today.getDay() === 0 ? 7 : today.getDay() // Mon=1…Sun=7
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - (dow - 1))

  // Start 11 weeks before this Monday → 12 weeks total
  const startDate = new Date(thisMonday)
  startDate.setDate(thisMonday.getDate() - 7 * 11)

  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const startLabel = fmt(startDate)
  const todayLabel = fmt(today)

  return (
    <div className="flex flex-col gap-2">
      {/* Date range labels */}
      <div className="ml-3.5 text-xs text-muted-foreground">
        From <span>{startLabel}</span> to <span>{todayLabel}</span>
      </div>

      {/* Horizontally scrollable wrapper for narrow screens */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div
          className="flex min-w-max gap-0.5"
          aria-label="Activity over the last 12 weeks"
        >
          {/* Day-of-week label column */}
          <div className="mr-0.5 flex flex-col gap-0.5">
            {DOW_LABELS.map((label, i) => (
              <span
                key={i}
                className="flex size-3.5 items-center justify-end text-sm leading-none text-muted-foreground sm:size-3"
              >
                {label}
              </span>
            ))}
          </div>

          {/* 12 week columns */}
          {Array.from({ length: 12 }, (_, week) => (
            <div key={week} className="flex flex-col gap-0.5">
              {Array.from({ length: 7 }, (_, day) => {
                const d = new Date(startDate)
                d.setDate(startDate.getDate() + week * 7 + day)
                const dateStr = toDateStr(d)
                const isActive = activeDaySet.has(dateStr)
                const isFuture = d > today
                return (
                  <div
                    key={day}
                    title={dateStr}
                    className={
                      isFuture
                        ? "invisible h-3.5 w-6 sm:h-3 sm:w-5"
                        : isActive
                          ? "h-3.5 w-6 rounded-xs bg-[var(--chart-1)] sm:h-3 sm:w-5"
                          : "h-3.5 w-6 rounded-xs bg-muted sm:h-3 sm:w-5"
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
