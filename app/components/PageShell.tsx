import { AppLink } from "~/components/AppLink"

interface PageShellProps {
  title?: string
  children: React.ReactNode
}

export function PageShell({ title, children }: PageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <AppLink to="/" variant="nav" className="mb-6">
          Back to map
        </AppLink>
        {!!title && (
          <h1 className="mb-8 text-2xl font-bold tracking-tight">{title}</h1>
        )}
        {children}
      </div>
    </div>
  )
}
