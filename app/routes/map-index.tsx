/**
 * The map itself is rendered by its parent layout route. Keeping this route
 * empty lets that layout stay mounted while other application pages render
 * through its Outlet.
 *
 * The parent layout is pathless, so no submission URL can target its
 * clientAction — React Router resolves an action to the deepest match with a
 * path, which for "/map" is this route. Re-export the action here so the map
 * UI can submit to "/map".
 */
export { clientAction } from "./home"

export default function MapIndexRoute() {
  return null
}
