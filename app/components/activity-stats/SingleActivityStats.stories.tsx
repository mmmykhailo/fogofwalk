import { useState } from "react"
import type { ActivityLap, ActivityStats } from "~/types/activities"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent, waitFor, within } from "storybook/test"

import {
  FIXTURE_ACTIVITY_START_MS,
  makeActivitySummary,
  makeParsedActivity,
} from "../../../.storybook/fixtures/activities"
import { useAuth } from "~/lib/server/authStore"

import { SingleActivityStats } from "./SingleActivityStats"

const meta = {
  title: "Activity statistics/SingleActivityStats",
  component: SingleActivityStats,
  args: { stats: makeParsedActivity().stats, activeLap: null },
  parameters: {
    layout: "padded",
    actionResult: {
      ok: true,
      operationId: "storybook-operation",
      revision: 2,
      coverageRevision: 2,
      updated: [],
    },
  },
} satisfies Meta<typeof SingleActivityStats>

export default meta
type Story = StoryObj<typeof meta>

const fullActivity = makeParsedActivity({ id: "stats-full" })

export const FullStats: Story = {
  args: {
    stats: fullActivity.stats,
    activeLap: null,
  },
}

export const SparseGpxStats: Story = {
  args: {
    stats: {
      ...fullActivity.stats,
      uniqueDistanceKm: 0,
      durationMs: null,
      movingTimeMs: null,
      avgPaceMinPerKm: null,
      avgMovingPaceMinPerKm: null,
      avgSpeedKmh: null,
      avgMovingSpeedKmh: null,
      elevationGainM: 0,
      elevationLossM: 0,
      hasElevation: false,
      elevationProfile: [],
    },
    activeLap: null,
  },
}

export const FitLaps: Story = {
  render: () => <LapStatsHarness />,
}

export const PublicSettings: Story = {
  render: () => {
    mocked(useAuth).mockReturnValue({
      status: "signedIn",
      user: {
        id: "fixture-user",
        displayName: "Alex Trail",
        avatarUrl: null,
        handle: "alex-trail",
        provider: "github",
        status: "allowed",
      },
      canSync: true,
      isAdmin: false,
    })
    return (
      <SingleActivityStats
        stats={fullActivity.stats}
        activeLap={null}
        activitySummary={makeActivitySummary({
          id: "stats-public",
          isPublic: true,
        })}
        canEditVisibility
      />
    )
  },
}

const onLapSelect = fn()

export const LapSelectionReportsNumber: Story = {
  render: () => <LapSelectionHarness />,
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("combobox", { name: "Select lap" })
    await userEvent.click(trigger)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: /Lap 2/ })
    )
    await expect(onLapSelect).toHaveBeenCalledWith(2)
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).not.toBeInTheDocument()
    )
  },
}

function LapSelectionHarness() {
  const [activeLapNumber, setActiveLapNumber] = useState<number | null>(null)
  const laps = makeLaps()
  const activeLap =
    laps.find((lap) => lap.number === activeLapNumber) ?? null

  return (
    <SingleActivityStats
      stats={activeLap?.stats ?? fullActivity.stats}
      laps={laps}
      activeLap={activeLap}
      onLapSelect={(lapNumber) => {
        onLapSelect(lapNumber)
        setActiveLapNumber(lapNumber)
      }}
    />
  )
}

function LapStatsHarness() {
  const [activeLapNumber, setActiveLapNumber] = useState<number | null>(null)
  const laps = makeLaps()
  const activeLap =
    laps.find((lap) => lap.number === activeLapNumber) ?? null
  return (
    <SingleActivityStats
      stats={activeLap?.stats ?? fullActivity.stats}
      laps={laps}
      activeLap={activeLap}
      onLapSelect={setActiveLapNumber}
    />
  )
}

function makeLaps(): ActivityLap[] {
  return [1, 2, 3].map((number, index) => {
    const stats: ActivityStats = {
      ...fullActivity.stats,
      distanceKm: 2.4 + index,
      uniqueDistanceKm: 0,
      elevationGainM: 30 + index * 10,
      elevationLossM: 24 + index * 8,
      elevationProfile: [
        { distanceKm: 0, elevationM: 240 + index * 5 },
        { distanceKm: 2.4 + index, elevationM: 270 + index * 5 },
      ],
    }
    return {
      number,
      startIndex: index,
      endIndex: index + 1,
      startedAtMs: FIXTURE_ACTIVITY_START_MS + index * 900_000,
      trigger: "distance",
      stats,
    }
  })
}
