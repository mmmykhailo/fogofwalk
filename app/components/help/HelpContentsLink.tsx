import { cn } from "~/lib/utils"

interface HelpContentsLinkProps {
  targetId: string
  /** Rendered number, e.g. "3." or "3.2". */
  marker: string
  /** Tailwind width for the marker column — sets the indent level. */
  markerWidth: string
  children: React.ReactNode
}

/**
 * Scrolling is driven from JS rather than left to the browser's native
 * fragment handling.
 *
 * `href` is still a real `#fragment`, so middle-click, "open in new tab" and
 * modified clicks all behave normally (we bail out of the handler for those),
 * and the link works with JS off. But a plain anchor jump depends on the
 * browser agreeing about which element scrolls, and `<html>`/`<body>` both
 * carry `height: 100%` here (the map route needs it) — which makes that
 * ambiguous across engines. `scrollIntoView` asks the element itself to come
 * into view, so it finds the right scroller everywhere.
 *
 * `replaceState` rather than letting the hash change: it keeps the URL
 * shareable without the browser queueing a second, competing jump, and avoids
 * filling the back button with one entry per contents click.
 */
export function HelpContentsLink({
  targetId,
  marker,
  markerWidth,
  children,
}: HelpContentsLinkProps) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const target = document.getElementById(targetId)
    if (!target) return

    event.preventDefault()
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    })
    window.history.replaceState(null, "", `#${targetId}`)
  }

  return (
    <span className="flex gap-2">
      <span
        aria-hidden="true"
        className={cn(
          markerWidth,
          "shrink-0 text-right text-muted-foreground tabular-nums"
        )}
      >
        {marker}
      </span>
      <a
        href={`#${targetId}`}
        onClick={handleClick}
        className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        {children}
      </a>
    </span>
  )
}
