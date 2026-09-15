import { within } from "storybook/test"

/** Query content rendered by Base UI/Vaul into document.body. */
export function portalWithin() {
  return within(document.body)
}

export function portalQuery<T extends Element = HTMLElement>(selector: string) {
  return document.body.querySelector<T>(selector)
}

export function portalQueries() {
  return {
    ...portalWithin(),
    query: portalQuery,
  }
}
