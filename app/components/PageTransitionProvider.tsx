import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  useLocation,
  useNavigate,
  type NavigateOptions,
  type To,
} from "react-router"

const DARKEN_DURATION_MS = 180
const VIEW_TRANSITION_DURATION_MS = 500

interface PageTransitionContextValue {
  navigate: (to: To, options?: NavigateOptions) => void
}

const PageTransitionContext = createContext<PageTransitionContextValue | null>(
  null
)

/**
 * Covers an outgoing page before its destination loader begins. The overlay
 * remains opaque until React Router has committed the new location, so slow
 * client loaders never leave the previous page visible underneath.
 */
export function PageTransitionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const location = useLocation()
  const routerNavigate = useNavigate()
  const [isCovering, setIsCovering] = useState(false)
  const pendingRef = useRef<{
    locationKey: string
    navigateTimer: number
  } | null>(null)

  const navigate = useCallback(
    (to: To, options: NavigateOptions = {}) => {
      if (pendingRef.current) return

      setIsCovering(true)
      const pending = {
        locationKey: location.key,
        navigateTimer: window.setTimeout(() => {
          routerNavigate(to, { ...options, viewTransition: true })
        }, DARKEN_DURATION_MS),
      }
      pendingRef.current = pending
    },
    [location.key, routerNavigate]
  )

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || pending.locationKey === location.key) return

    // The route was committed under the opaque overlay. Wait for the View
    // Transition snapshot animation, then reveal the new page.
    const revealTimer = window.setTimeout(() => {
      setIsCovering(false)
      pendingRef.current = null
    }, VIEW_TRANSITION_DURATION_MS)
    return () => window.clearTimeout(revealTimer)
  }, [location.key])

  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (pending) window.clearTimeout(pending.navigateTimer)
    },
    []
  )

  return (
    <PageTransitionContext.Provider value={{ navigate }}>
      {children}
      <div
        aria-hidden="true"
        data-page-transition-overlay
        className={
          isCovering
            ? "pointer-events-auto fixed inset-0 z-[200] bg-[#0a0a1e] opacity-100 transition-opacity duration-200 motion-reduce:transition-none"
            : "pointer-events-none fixed inset-0 z-[200] bg-[#0a0a1e] opacity-0 transition-opacity duration-200 motion-reduce:transition-none"
        }
      />
    </PageTransitionContext.Provider>
  )
}

export function usePageTransition(): PageTransitionContextValue {
  const context = useContext(PageTransitionContext)
  if (!context) {
    throw new Error(
      "usePageTransition must be used within PageTransitionProvider"
    )
  }
  return context
}
