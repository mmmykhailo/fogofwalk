import { createMemoryRouter, type RouteObject } from "react-router"

export function createStoryMemoryRouter(
  routes: RouteObject[],
  initialEntries: string[] = ["/"]
) {
  return createMemoryRouter(routes, { initialEntries })
}

export function currentStoryPath(
  router: ReturnType<typeof createMemoryRouter>
) {
  return `${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`
}
