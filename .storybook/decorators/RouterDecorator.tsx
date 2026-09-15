import { useEffect, useMemo } from "react"
import {
  createMemoryRouter,
  RouterProvider,
  type ActionFunctionArgs,
  type InitialEntry,
  type LoaderFunctionArgs,
  type RouteObject,
} from "react-router"
import type { Decorator } from "@storybook/react-vite"

import { PageTransitionProvider } from "~/components/PageTransitionProvider"

export interface StoryRouterActionArgs {
  request: Request
  params: Readonly<Record<string, string | undefined>>
}

export type StoryRouterSpy = (args: StoryRouterActionArgs) => unknown

export interface StoryRouterResource {
  path: string
  loaderData?: unknown
  actionResult?: unknown
  actionSpy?: StoryRouterSpy
}

export interface StoryRouterParameters {
  initialEntries?: InitialEntry[]
  initialIndex?: number
  loaderData?: unknown
  actionResult?: unknown
  actionSpy?: StoryRouterSpy
  resources?: StoryRouterResource[]
  withTransition?: boolean
}

function createLoader(data: unknown) {
  return (_args: LoaderFunctionArgs) => data
}

function createAction(result: unknown, spy?: StoryRouterSpy) {
  return async (args: ActionFunctionArgs) => {
    spy?.({ request: args.request, params: args.params })
    return result
  }
}

function createRoutes(
  Story: React.ComponentType,
  parameters: StoryRouterParameters
): RouteObject[] {
  const resources = (parameters.resources ?? []).map((resource, index) => ({
    id: `storybook-resource-${index}`,
    path: resource.path,
    loader: createLoader(resource.loaderData),
    action: createAction(resource.actionResult, resource.actionSpy),
  }))

  const story =
    parameters.withTransition === false ? (
      <Story />
    ) : (
      <PageTransitionProvider>
        <Story />
      </PageTransitionProvider>
    )

  return [
    ...resources,
    {
      id: "storybook-story",
      path: "*",
      loader: createLoader(parameters.loaderData),
      action: createAction(parameters.actionResult, parameters.actionSpy),
      element: story,
    },
  ]
}

function StoryRouter({
  Story,
  parameters,
}: {
  Story: React.ComponentType
  parameters: StoryRouterParameters
}) {
  const router = useMemo(
    () =>
      createMemoryRouter(createRoutes(Story, parameters), {
        initialEntries: parameters.initialEntries ?? ["/"],
        initialIndex: parameters.initialIndex,
      }),
    [Story, parameters]
  )

  useEffect(() => () => router.dispose(), [router])

  return <RouterProvider router={router} />
}

/**
 * Storybook's data-router boundary. A keyed child gives every story a fresh
 * memory router, including fresh query strings and fetcher state.
 */
export const RouterDecorator: Decorator = (Story, context) => {
  const parameters =
    (context.parameters.router as StoryRouterParameters | undefined) ?? {}

  return <StoryRouter key={context.id} Story={Story} parameters={parameters} />
}
