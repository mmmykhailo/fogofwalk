import { HELP_SECTIONS } from "~/components/help/sections"
import { HelpContentsLink } from "~/components/help/HelpContentsLink"

export function HelpContents() {
  return (
    <nav aria-labelledby="contents-heading" className="mb-10">
      <h2
        id="contents-heading"
        className="mb-4 text-xl font-semibold text-foreground"
      >
        Contents
      </h2>
      <ol className="space-y-1.5 text-sm">
        {HELP_SECTIONS.map(({ id, title, children }, sectionIndex) => (
          <li key={id}>
            <HelpContentsLink
              targetId={id}
              marker={`${sectionIndex + 1}.`}
              markerWidth="w-7"
            >
              {title}
            </HelpContentsLink>
            {children && (
              <ol className="mt-1 space-y-1">
                {children.map((child, childIndex) => (
                  <li key={child.id}>
                    <HelpContentsLink
                      targetId={child.id}
                      marker={`${sectionIndex + 1}.${childIndex + 1}`}
                      markerWidth="w-11"
                    >
                      {child.title}
                    </HelpContentsLink>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
