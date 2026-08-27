interface HelpSubheadingProps {
  /** Anchor target for the nested entries in the contents list. */
  id: string
  children: React.ReactNode
}

export function HelpSubheading({ id, children }: HelpSubheadingProps) {
  return (
    <h3 id={id} className="mb-1 scroll-mt-6 font-medium text-foreground">
      {children}
    </h3>
  )
}
