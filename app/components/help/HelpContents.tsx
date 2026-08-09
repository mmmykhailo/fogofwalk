import { HELP_SECTIONS } from "~/components/help/sections"

/**
 * Plain `#fragment` anchors — no click handler and no router navigation, so
 * they keep working with JS off, honour middle-click and "open in new tab",
 * and land correctly when someone arrives on /help#photos from outside.
 * Smooth scrolling comes from `scroll-behavior` in app.css, which is gated on
 * `prefers-reduced-motion`.
 */
export function HelpContents() {
  return (
    <nav aria-labelledby="contents-heading" className="mb-10">
      <h2
        id="contents-heading"
        className="mb-4 text-xl font-semibold text-foreground"
      >
        Contents
      </h2>
      <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {HELP_SECTIONS.map(({ id, title }, i) => (
          <li key={id} className="flex gap-2">
            <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
              {i + 1}.
            </span>
            <a
              href={`#${id}`}
              className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
