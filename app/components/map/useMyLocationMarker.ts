import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import { mapStore } from "~/lib/mapStore"

export function useMyLocationMarker(
  showMyLocation: boolean,
  myLocation: [number, number] | null
): void {
  const markerRef = useRef<maplibregl.Marker | null>(null)

  // A DOM marker survives setStyle and can update without rebuilding its element.
  useEffect(() => {
    const map = mapStore.map
    if (!map) return

    if (!showMyLocation || !myLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    if (markerRef.current) {
      markerRef.current.setLngLat(myLocation)
      return
    }

    const element = document.createElement("div")
    element.style.cssText =
      "width:14px;height:14px;border-radius:50%;background:#4285f4;" +
      "border:2px solid white;box-shadow:0 0 0 4px rgba(66,133,244,0.35);"
    markerRef.current = new maplibregl.Marker({ element })
      .setLngLat(myLocation)
      .addTo(map)
  }, [showMyLocation, myLocation])

  // Position updates must not tear down and recreate the marker element.
  useEffect(
    () => () => {
      markerRef.current?.remove()
      markerRef.current = null
    },
    []
  )
}
