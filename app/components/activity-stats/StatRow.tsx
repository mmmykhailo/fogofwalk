interface StatRowProps {
  label: string
  value: string
}

/**
 * One label/value pair. Renders a bare fragment so consecutive rows flow into
 * the parent's two-column grid rather than each forming their own row.
 */
export function StatRow({ label, value }: StatRowProps) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </>
  )
}
