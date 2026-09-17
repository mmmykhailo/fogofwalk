const MAPTOOLKIT_TILE_HOSTNAME = "tiles.maptoolkit.org"

export function isMapTileRequest({ url }: { url: URL }): boolean {
  if (url.hostname === MAPTOOLKIT_TILE_HOSTNAME) return false
  return url.pathname.includes("/tiles/") || url.pathname.endsWith(".mvt")
}

export function isMapStyleRequest({ url }: { url: URL }): boolean {
  if (url.hostname === MAPTOOLKIT_TILE_HOSTNAME) return false
  return url.pathname.endsWith(".json")
}
