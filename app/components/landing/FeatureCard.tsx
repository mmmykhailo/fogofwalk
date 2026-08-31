import type { Icon } from "@phosphor-icons/react"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

interface FeatureCardProps {
  icon: Icon
  title: string
  children: React.ReactNode
}

export function FeatureCard({
  icon: IconComponent,
  title,
  children,
}: FeatureCardProps) {
  return (
    <Card className="h-full gap-3 border border-border bg-card shadow-none">
      <CardHeader className="gap-3">
        <span className="grid size-9 place-items-center bg-secondary text-foreground">
          <IconComponent size={20} weight="duotone" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  )
}
