import { useCallback, useEffect, useRef, useState } from "react"

const STORAGE_KEY = "fogofwalk:showMyLocation"

/** Only ever written `true` after a real successful fix — see `enable()`. */
function readSavedShowMyLocation(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function saveShowMyLocation(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // localStorage unavailable (private browsing with storage blocked, etc.)
  }
}

export interface MyLocationState {
  showMyLocation: boolean
  /** True once the user has denied the geolocation permission prompt. */
  permissionDenied: boolean
  position: [number, number] | null
  /** Pass straight to a Switch's onCheckedChange. */
  toggle: (checked: boolean) => void
}

/**
 * Manages the "show my location" toggle: requests geolocation permission on
 * first enable, watches position while enabled, and latches permissionDenied
 * so the caller can disable the control instead of re-prompting forever.
 *
 * The on/off state survives reloads via localStorage, but the flag is only
 * ever trusted as a hint to retry — permission can be revoked outside the app
 * between sessions, so mount always re-asks rather than assuming success.
 */
export function useMyLocation(): MyLocationState {
  const [showMyLocation, setShowMyLocation] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [position, setPosition] = useState<[number, number] | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setPosition(null)
  }, [])

  const startWatching = useCallback(() => {
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => setPosition([pos.coords.longitude, pos.coords.latitude]),
      (err) => {
        // A permission revoked mid-session behaves the same as an initial denial.
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionDenied(true)
          setShowMyLocation(false)
          saveShowMyLocation(false)
          stopWatching()
        }
      },
      { enableHighAccuracy: true }
    )
  }, [stopWatching])

  const enable = useCallback(() => {
    if (!navigator.geolocation) {
      setPermissionDenied(true)
      return
    }
    // getCurrentPosition is what actually triggers the browser's permission
    // prompt the first time — watchPosition alone would too, but this way
    // we get a single one-shot result to gate the switch on before committing
    // to a live watch. If permission was already granted in a prior session,
    // this resolves silently with no prompt.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.longitude, pos.coords.latitude])
        setShowMyLocation(true)
        saveShowMyLocation(true)
        startWatching()
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPermissionDenied(true)
        setShowMyLocation(false)
        saveShowMyLocation(false)
      }
    )
  }, [startWatching])

  const toggle = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setShowMyLocation(false)
        saveShowMyLocation(false)
        stopWatching()
        return
      }
      enable()
    },
    [enable, stopWatching]
  )

  // Restore on mount if it was on last session — silent re-grant if the
  // browser still remembers the permission, self-correcting to off/denied if not.
  useEffect(() => {
    if (readSavedShowMyLocation()) enable()
  }, [enable])

  useEffect(() => stopWatching, [stopWatching])

  return { showMyLocation, permissionDenied, position, toggle }
}
