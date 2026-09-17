const MAPTOOLKIT_TILE_HOSTNAME = "tiles.maptoolkit.org"
const OPENFREEMAP_TILE_HOSTNAME = "tiles.openfreemap.org"
const OPENFREEMAP_TILE_PATH = /^\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/

export function isMapTileRequest({ url }: { url: URL }): boolean {
  if (url.hostname === MAPTOOLKIT_TILE_HOSTNAME) return false
  return (
    url.hostname === OPENFREEMAP_TILE_HOSTNAME &&
    OPENFREEMAP_TILE_PATH.test(url.pathname)
  )
}

export function isMapStyleRequest({ url }: { url: URL }): boolean {
  if (url.hostname === MAPTOOLKIT_TILE_HOSTNAME) return false
  return url.pathname.endsWith(".json")
}
