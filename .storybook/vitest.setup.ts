import { afterEach, vi } from "vitest"

// Storybook's Vitest plugin installs its generated project annotations before
// this file, including the addon-a11y annotations. Keep module spies isolated
// so one story cannot change the starting state of the next story.
afterEach(() => {
  vi.restoreAllMocks()
})
