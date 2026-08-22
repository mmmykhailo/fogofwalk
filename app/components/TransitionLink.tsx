import { forwardRef } from "react"
import { Link, type LinkProps } from "react-router"
import { usePageTransition } from "~/components/PageTransitionProvider"

/**
 * The app's standard internal link. React Router wraps these navigations in
 * the browser View Transitions API when it is available, with an ordinary
 * client-side navigation as the fallback.
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, LinkProps>(
  function TransitionLink(
    {
      onClick,
      reloadDocument,
      replace,
      state,
      preventScrollReset,
      relative,
      target,
      to,
      viewTransition = true,
      ...props
    },
    ref
  ) {
    const { navigate } = usePageTransition()

    return (
      <Link
        ref={ref}
        {...props}
        to={to}
        target={target}
        reloadDocument={reloadDocument}
        viewTransition={viewTransition}
        onClick={(event) => {
          onClick?.(event)
          if (
            event.defaultPrevented ||
            reloadDocument ||
            target ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey
          ) {
            return
          }
          event.preventDefault()
          navigate(to, { replace, state, preventScrollReset, relative })
        }}
      />
    )
  }
)
