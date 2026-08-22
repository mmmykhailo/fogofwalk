import { forwardRef } from "react"
import { Link, type LinkProps } from "react-router"

/**
 * The app's standard internal link. React Router wraps these navigations in
 * the browser View Transitions API when it is available, with an ordinary
 * client-side navigation as the fallback.
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, LinkProps>(
  function TransitionLink({ viewTransition = true, ...props }, ref) {
    return <Link ref={ref} viewTransition={viewTransition} {...props} />
  }
)
