interface PageSectionProps {
  title: string
  /**
   * Anchor target for in-page links (the /help contents list). The scroll
   * margin keeps the heading off the very top edge when jumped to.
   */
  id?: string
  children: React.ReactNode
}

export function PageSection({ title, id, children }: PageSectionProps) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}
