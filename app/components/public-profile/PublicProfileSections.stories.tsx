import { useState } from "react"
import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import {
  makeAchievementPrevalence,
  makeAchievements,
  makeAchievementsByFamily,
  makeEarnedAchievement,
} from "../../../.storybook/fixtures/achievements"
import {
  makePublicActivity,
  makePublicProfile,
} from "../../../.storybook/fixtures/publicProfile"
import { makeLifetimeTotals } from "../../../.storybook/fixtures/stats"
import { makeSavedPoint } from "../../../.storybook/fixtures/savedPoints"

import { AchievementsSection } from "./AchievementsSection"
import { AchievementCard } from "./AchievementCard"
import { PublicActivitiesSection } from "./PublicActivitiesSection"
import { PublicProfileHeader } from "./PublicProfileHeader"
import { PublicProfileSummary } from "./PublicProfileSummary"
import { RecentActivityCalendarCard } from "./RecentActivityCalendarCard"
import { SavedPointsSection } from "./SavedPointsSection"

const avatarDataUrl =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
const profile = makePublicProfile()
const profileUser = { ...profile.user, avatarUrl: avatarDataUrl }
const stats = {
  totals: makeLifetimeTotals(),
  firstActivityMs: Date.parse("2026-03-19T06:30:00.000Z"),
  latestActivityMs: Date.parse("2026-09-15T06:30:00.000Z"),
  recentDays: ["2026-09-12", "2026-09-14", "2026-09-15"],
  weekly: [],
}

const meta = {
  title: "Public profile/Profile sections",
  component: PublicProfileHeader,
  args: { user: profileUser },
  parameters: { layout: "padded" },
} satisfies Meta<typeof PublicProfileHeader>

export default meta
type Story = StoryObj<typeof meta>

export const HeaderWithAvatar: Story = {
  args: {
    user: { ...profile.user, avatarUrl: avatarDataUrl },
  },
  play: async ({ canvas, canvasElement }) => {
    const image = canvasElement.querySelector("img")
    if (!image) throw new Error("Expected the avatar image")
    await expect(image).toHaveAttribute("alt", "")
    await expect(canvas.getByText("Alex Trail")).toBeVisible()
  },
}

export const HeaderInitialsFallback: Story = {
  args: { user: { ...profile.user, avatarUrl: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("AT")).toBeVisible()
    await expect(canvas.getByText("@alex-trail")).toBeVisible()
  },
}

export const HeaderLinkedHandle: Story = {
  render: () => <HeaderNavigationHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: "@alex-trail" }))
    await waitFor(() =>
      expect(canvas.getByTestId("profile-location")).toHaveTextContent(
        "/u/alex-trail"
      )
    )
  },
}

export const HeaderCustomSectionTitle: Story = {
  args: { title: "Trail journal" },
}

export const SummaryNormalRange: Story = {
  render: () => <PublicProfileSummary stats={stats} />,
}

export const SummaryNullDateRange: Story = {
  render: () => (
    <PublicProfileSummary
      stats={{ ...stats, firstActivityMs: null, latestActivityMs: null }}
    />
  ),
}

export const SummarySameDay: Story = {
  render: () => (
    <PublicProfileSummary
      stats={{
        ...stats,
        firstActivityMs: Date.parse("2026-09-15T06:30:00.000Z"),
        latestActivityMs: Date.parse("2026-09-15T18:30:00.000Z"),
      }}
    />
  ),
}

export const RecentActivityCalendar: Story = {
  render: () => <RecentActivityCalendarCard recentDays={stats.recentDays} />,
}

export const AchievementCardWithPrevalence: Story = {
  render: () => (
    <AchievementCard
      achievement={makeEarnedAchievement("running-5k")}
      achievementPrevalence={makeAchievementPrevalence({ "running-5k": 18.4 })}
    />
  ),
  play: async ({ canvas }) => {
    const prevalence = canvas.getByText("18.4%")
    await userEvent.tab()
    await expect(prevalence).toHaveFocus()
    await userEvent.hover(prevalence)
    await waitFor(() =>
      expect(
        within(document.body).getByText(
          "Only 18.4% of users have this achievement"
        )
      ).toBeVisible()
    )
    await userEvent.unhover(prevalence)
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("tooltip")
      ).not.toBeInTheDocument()
    )
  },
}

export const AchievementFamilies: Story = {
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["duration", "elevation", "sun", "distance"] as const).map((family) => (
        <section key={family} aria-label={`${family} achievements`}>
          <AchievementCard achievement={makeAchievementsByFamily(family)[0]!} />
        </section>
      ))}
    </div>
  ),
}

export const AchievementPrevalenceStates: Story = {
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2">
      {makeAchievements().map((achievement) => (
        <AchievementCard
          key={achievement.definition.id}
          achievement={achievement}
          achievementPrevalence={makeAchievementPrevalence({
            [achievement.definition.id]:
              achievement.definition.id === "time-on-feet-3h"
                ? 100
                : achievement.definition.id === "elevation-500m"
                  ? 2.5
                  : achievement.definition.id === "early-bird"
                    ? 0
                    : 18.4,
          })}
        />
      ))}
      <AchievementCard
        achievement={makeEarnedAchievement("night-owl", { earnedAtMs: null })}
      />
    </div>
  ),
}

export const AchievementsEmpty: Story = {
  render: () => <AchievementsSection achievements={[]} />,
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("heading", { name: "Achievements" })
    ).not.toBeInTheDocument()
  },
}

export const AchievementsGrouped: Story = {
  render: () => (
    <AchievementsSection
      achievements={makeAchievements([
        "time-on-feet-3h",
        "elevation-500m",
        "early-bird",
        "running-5k",
      ])}
      groupByFamily
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Time" })).toBeVisible()
    await expect(
      canvas.getByRole("heading", { name: "Elevation gain" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("heading", { name: "Time of day" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("heading", { name: "Distance" })
    ).toBeVisible()
  },
}

export const AchievementsUngrouped: Story = {
  render: () => (
    <AchievementsSection
      achievements={makeAchievements()}
      groupByFamily={false}
      showHeading={false}
    />
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("region", { name: "Achievements" })
    ).toBeVisible()
  },
}

export const AchievementsTruncatedWithViewAll: Story = {
  render: () => <AchievementsNavigationHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("link", { name: "View all achievements" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("profile-location")).toHaveTextContent(
        "/u/alex-trail/achievements"
      )
    )
  },
}

export const PublicActivitiesEmpty: Story = {
  render: () => <PublicActivitiesSection activities={[]} />,
}

export const PublicActivitiesOnePage: Story = {
  render: () => (
    <PublicActivitiesSection
      activities={[makePublicActivity({ contentHash: "public-one" })]}
    />
  ),
}

export const PublicActivitiesPaginated: Story = {
  render: () => <PaginatedActivitiesHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(canvas.getByTestId("public-activity-page")).toHaveTextContent(
      "2"
    )
    await expect(
      canvas.getByText("Showing 3–4 of 7 public activities")
    ).toBeVisible()
  },
}

const hideAction = fn()

export const PublicActivitiesOwnerActions: Story = {
  parameters: {
    router: {
      actionResult: {
        ok: true,
        intent: "hide-activity",
        contentHash: "owner-public-hash",
      },
      actionSpy: hideAction,
    },
  },
  render: () => (
    <PublicActivitiesSection
      activities={[
        makePublicActivity({
          contentHash: "owner-public-hash",
          name: "Owner route.gpx",
        }),
      ]}
      isOwner
    />
  ),
  play: async ({ canvas }) => {
    hideAction.mockClear()
    await userEvent.click(
      canvas.getByRole("button", { name: "Activity actions for Owner route" })
    )
    await userEvent.click(
      await within(document.body).findByRole("menuitem", {
        name: "Hide from profile",
      })
    )
    await waitFor(() => expect(hideAction).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).not.toBeInTheDocument()
    )
    const args = hideAction.mock.calls[0]?.[0] as {
      request: Request
    }
    const formData = await args.request.formData()
    await expect(formData.get("intent")).toBe("hide-activity")
    await expect(formData.get("contentHash")).toBe("owner-public-hash")
  },
}

export const SavedPointsEmpty: Story = {
  render: () => <SavedPointsSection points={[]} />,
}

export const SavedPointsPreview: Story = {
  render: () => (
    <SavedPointsSection
      points={[makeSavedPoint({ id: "public-point-preview", isPublic: true })]}
    />
  ),
}

export const SavedPointsTruncatedWithViewAll: Story = {
  render: () => <SavedPointsNavigationHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: "View all points" }))
    await waitFor(() =>
      expect(canvas.getByTestId("profile-location")).toHaveTextContent(
        "/u/alex-trail/saved-points"
      )
    )
  },
}

function HeaderNavigationHarness() {
  const location = useLocation()
  return (
    <>
      <PublicProfileHeader user={profileUser} profilePath="/u/alex-trail" />
      <output data-testid="profile-location" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}

function AchievementsNavigationHarness() {
  const location = useLocation()
  return (
    <>
      <AchievementsSection
        achievements={makeAchievements([
          "time-on-feet-3h",
          "elevation-500m",
          "early-bird",
          "running-5k",
        ])}
        maxAchievements={2}
        viewAllTo="/u/alex-trail/achievements"
        groupByFamily={false}
      />
      <output data-testid="profile-location" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}

function PaginatedActivitiesHarness() {
  const [currentPage, setCurrentPage] = useState(1)
  const activities = [
    makePublicActivity({ contentHash: "public-page-1" }),
    makePublicActivity({ contentHash: "public-page-2" }),
  ]
  return (
    <>
      <PublicActivitiesSection
        activities={activities}
        pagination={{
          itemCount: 7,
          pageSize: 2,
          currentPage,
          totalPages: 4,
          onPageChange: setCurrentPage,
        }}
      />
      <output data-testid="public-activity-page" className="sr-only">
        {currentPage}
      </output>
    </>
  )
}

function SavedPointsNavigationHarness() {
  const location = useLocation()
  const points = [
    makeSavedPoint({ id: "public-point-1", isPublic: true }),
    makeSavedPoint({ id: "public-point-2", isPublic: true, name: "Hilltop" }),
    makeSavedPoint({ id: "public-point-3", isPublic: true, name: "Lookout" }),
  ]
  return (
    <>
      <SavedPointsSection
        points={points}
        maxPoints={2}
        hasMore
        viewAllTo="/u/alex-trail/saved-points"
      />
      <output data-testid="profile-location" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}
