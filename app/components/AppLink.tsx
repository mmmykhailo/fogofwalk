import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { LinkProps } from "react-router"
import { cn } from "~/lib/utils"
import { TransitionLink } from "~/components/TransitionLink"

const variants = {
  nav: "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
  subtle: "text-xs text-foreground underline-offset-2 hover:underline",
} as const

interface AppLinkProps {
  to: string
  variant?: keyof typeof variants
  className?: string
  title?: string
  state?: LinkProps["state"]
  children: React.ReactNode
}

export function AppLink({
  to,
  variant = "subtle",
  className,
  title,
  state,
  children,
}: AppLinkProps) {
  return (
    <TransitionLink
      to={to}
      state={state}
      className={cn(variants[variant], className)}
      title={title}
    >
      {variant === "nav" && <ArrowLeftIcon size={16} />}
      {children}
    </TransitionLink>
  )
}
