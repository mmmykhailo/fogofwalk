export {}

declare global {
  interface FogofwalkE2eMap {
    project(coordinate: [number, number]): { x: number; y: number }
    getCanvas(): HTMLCanvasElement
    getZoom(): number
    getLayer(id: string): unknown
    queryRenderedFeatures(
      point: [number, number],
      options: { layers: readonly string[] }
    ): unknown[]
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
  }

  interface Window {
    __fogofwalkE2eMap?: FogofwalkE2eMap
    __fogofwalkE2eMapStore?: { sourcesReady: boolean }
    __fogofwalkE2eShareGeometry?: {
      type?: string
      coordinates?: unknown
    }
  }
}
