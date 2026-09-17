export {}

declare global {
  interface FogofwalkE2eMap {
    project(coordinate: [number, number]): { x: number; y: number }
    getCanvas(): HTMLCanvasElement
    getZoom(): number
    setZoom(zoom: number): void
    getLayer(id: string): unknown
    getStyle(): { layers?: unknown[] }
    queryRenderedFeatures(
      geometry?: [number, number] | [[number, number], [number, number]],
      options?: { layers?: readonly string[] }
    ): unknown[]
    querySourceFeatures(sourceId: string, options?: unknown): unknown[]
    jumpTo(options: { center: [number, number]; zoom: number }): void
    easeTo(options: {
      zoom: number
      duration: number
      essential: boolean
    }): void
    on(event: string, handler: () => void): void
    once(event: string, handler: () => void): void
    off(event: string, handler?: () => void): void
    getSource(id: string): unknown
    getCenter(): { lng: number; lat: number }
    isStyleLoaded(): boolean
  }

  interface Window {
    __fogofwalkE2eMap?: FogofwalkE2eMap
    __fogofwalkE2eOriginalMap?: FogofwalkE2eMap
    __fogofwalkE2eMapStore?: { sourcesReady: boolean }
    __fogofwalkE2eShareGeometry?: {
      type?: string
      coordinates?: unknown
    }
  }
}
