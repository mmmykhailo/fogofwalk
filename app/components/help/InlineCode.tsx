interface InlineCodeProps {
  children: React.ReactNode
}

export function InlineCode({ children }: InlineCodeProps) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
  )
}
