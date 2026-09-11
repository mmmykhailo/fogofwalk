export {}

declare global {
  interface FogofwalkE2eMap {
    project(coordinate: [number, number]): { x: number; y: number }
    getCanvas(): HTMLCanvasElement
    getLayer(id: string): unknown
    queryRenderedFeatures(
      point: [number, number],
      options: { layers: readonly string[] }
    ): unknown[]
    jumpTo(options: { center: [number, number]; zoom: number }): void
    getSource(id: string): unknown
  }

  interface Window {
    __fogofwalkE2eMap?: FogofwalkE2eMap
    __fogofwalkE2eShareGeometry?: {
      type?: string
      coordinates?: unknown
    }
  }
}
