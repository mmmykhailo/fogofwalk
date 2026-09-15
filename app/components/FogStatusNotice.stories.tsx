import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import type { FogProjectionStatus } from "~/lib/mapStore"

import { FogStatusNoticeView } from "./FogStatusNotice"

const meta = {
  title: "Feedback/FogStatusNoticeView",
  component: FogStatusNoticeView,
  parameters: {
    layout: "padded",
    router: { withTransition: false },
  },
} satisfies Meta<typeof FogStatusNoticeView>

export default meta
type Story = StoryObj<typeof meta>

export const HiddenIdle: Story = {
  args: { status: status(), onRetry: fn() },
}

export const DegradedWarning: Story = {
  args: {
    status: status({ phase: "degraded", rejectedActivityCount: 1 }),
    onRetry: fn(),
  },
}

export const ReducedCoverageCounts: Story = {
  args: {
    status: status({
      phase: "degraded",
      coverageReducedActivityCount: 2,
      coverageReducedCounts: { validation_budget_exceeded: 2 },
    }),
    onRetry: fn(),
  },
}

export const RetryableFailure: Story = {
  args: {
    status: status({
      phase: "failed",
      error: "The fog worker stopped before the route could be rendered.",
      retryable: true,
    }),
    onRetry: fn(),
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Retry fog processing" })
    )
    await expect(args.onRetry).toHaveBeenCalledTimes(1)
  },
}

export const NonRetryableFailure: Story = {
  args: {
    status: status({ phase: "failed", error: "The geometry is unavailable." }),
    onRetry: fn(),
  },
}

export const LongErrorText: Story = {
  args: {
    status: status({
      phase: "failed",
      error:
        "The route was retained, but its explored region could not be validated within the browser's geometry and serialized-byte budgets. Try rebuilding after removing unusually dense or damaged activity files.",
      retryable: true,
    }),
    onRetry: fn(),
  },
}

function status(
  overrides: Partial<FogProjectionStatus> = {}
): FogProjectionStatus {
  return {
    phase: "idle",
    requestId: null,
    generation: 1,
    libraryRevision: 1,
    coverageRevision: 1,
    mode: "corridor",
    processed: 0,
    total: 0,
    error: null,
    warnings: [],
    recoveryAttempts: 0,
    retryable: false,
    warningCounts: {},
    errorCounts: {},
    infoCounts: {},
    coverageReducedCounts: {},
    normalizedActivityCount: 0,
    repairedActivityCount: 0,
    rejectedActivityCount: 0,
    geometryFallbackCount: 0,
    coverageReducedActivityCount: 0,
    ...overrides,
  }
}
