export function ActivityStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
