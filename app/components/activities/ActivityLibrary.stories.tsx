import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent, waitFor, within } from "storybook/test"

import { makeActivitySummary } from "../../../.storybook/fixtures/activities"
import { useAuth } from "~/lib/server/authStore"

import { ActivityLibrary } from "./ActivityLibrary"

const successResult = {
  ok: true as const,
  operationId: "storybook-operation",
  revision: 4,
  coverageRevision: 4,
  updated: [],
}

const failureResult = {
  ok: false as const,
  operationId: "storybook-operation",
  error: "The server rejected the bulk activity update.",
}

const meta = {
  title: "Activities/ActivityLibrary",
  component: ActivityLibrary,
  args: { activities: [makeActivitySummary()] },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ActivityLibrary>

export default meta
type Story = StoryObj<typeof meta>

export const FewerThanOnePage: Story = {
  render: () => {
    setDisabledAuth()
    return <ActivityLibrary activities={makeActivities(3, "short")} />
  },
}

export const MoreThanOnePage: Story = {
  parameters: {
    router: { initialEntries: ["/activities?sort=date"] },
  },
  render: () => {
    setDisabledAuth()
    return <ActivityLibrary activities={makeActivities(52, "paged")} />
  },
}

export const QuerySelectedSortAndPage: Story = {
  parameters: {
    router: { initialEntries: ["/activities?sort=distance&page=2"] },
  },
  render: () => {
    setDisabledAuth()
    return <ActivityLibrary activities={makeActivities(52, "query")} />
  },
}

export const AuthenticatedEditableSet: Story = {
  render: () => {
    setApprovedAuth()
    return (
      <ActivityLibrary
        activities={[
          makeActivitySummary({ id: "editable-walk", name: "Park walk.gpx" }),
          makeActivitySummary({
            id: "editable-ride",
            name: "City ride.fit",
            activityType: "cycling",
            isPublic: true,
          }),
        ]}
      />
    )
  },
}

export const UnsyncedSetWithDisabledVisibility: Story = {
  render: () => {
    setPendingAuth()
    return <ActivityLibrary activities={makeActivities(2, "pending")} />
  },
}

export const SortAndPaginate: Story = {
  parameters: {
    router: { initialEntries: ["/activities?sort=date"] },
  },
  render: () => {
    setDisabledAuth()
    return <ActivityLibraryWithLocation activities={makeActivities(52, "actions")} />
  },
  play: async ({ canvas }) => {
    const sort = await canvas.findByRole("combobox", { name: "Sort by" })
    await userEvent.click(sort)
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Distance" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("activity-library-location")).toHaveTextContent(
        "sort=distance"
      )
    )

    await userEvent.click(await canvas.findByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(canvas.getByTestId("activity-library-location")).toHaveTextContent(
        "sort=distance&page=2"
      )
    )
    await expect(canvas.getByTestId("activities-grid")).toHaveFocus()
  },
}

const bulkActionSpy = fn()

export const BulkUpdateSuccess: Story = {
  parameters: {
    router: { actionResult: successResult, actionSpy: bulkActionSpy },
  },
  render: () => {
    setApprovedAuth()
    return <ActivityLibrary activities={makeActivities(3, "bulk-success")} />
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Select all" }))
    await userEvent.click(
      await canvas.findByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Running" })
    )
    await expect(
      await within(document.body).findByRole("dialog", {
        name: "Change 3 activities to Running?",
      })
    ).toBeVisible()
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Confirm" })
    )
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog", {
          name: "Change 3 activities to Running?",
        })
      ).not.toBeInTheDocument()
    )
    await expect(canvas.getByText("Selected 3 activities")).toBeVisible()
    await expect(
      canvas.getByRole("combobox", {
        name: "Set activity type for selected activities",
      })
    ).toHaveTextContent("Running")
    await expect(bulkActionSpy).toHaveBeenCalledTimes(1)
  },
}

export const BulkUpdateFailureRollsBack: Story = {
  parameters: {
    router: { actionResult: failureResult, actionSpy: fn() },
  },
  render: () => {
    setApprovedAuth()
    return <ActivityLibrary activities={makeActivities(2, "bulk-failure")} />
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Select all" }))
    await userEvent.click(
      await canvas.findByRole("combobox", {
        name: "Set visibility for selected activities",
      })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Public" })
    )
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Confirm" })
    )
    await expect(
      await within(document.body).findByRole("alert")
    ).toHaveTextContent("server rejected")
    await expect(
      within(document.body).getByRole("combobox", {
        name: "Set visibility for selected activities",
        hidden: true,
      })
    ).toHaveTextContent("Private")
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Cancel" })
    )
  },
}

function ActivityLibraryWithLocation({
  activities,
}: {
  activities: ReturnType<typeof makeActivitySummary>[]
}) {
  const location = useLocation()
  return (
    <>
      <ActivityLibrary activities={activities} />
      <output data-testid="activity-library-location" className="sr-only">
        {location.pathname + location.search}
      </output>
    </>
  )
}

function makeActivities(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) =>
    makeActivitySummary({
      id: `${prefix}-${index + 1}`,
      name: `${prefix} activity ${String(index + 1).padStart(2, "0")}.gpx`,
      startedAtMs: Date.parse("2026-09-15T06:30:00.000Z") - index * 86_400_000,
      stats: {
        distanceKm: 3 + (index % 10) * 1.2,
        elevationGainM: 40 + index * 3,
      },
    })
  )
}

function setDisabledAuth() {
  mocked(useAuth).mockReturnValue({ status: "disabled" })
}

function setPendingAuth() {
  mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: {
      id: "pending-user",
      displayName: "Pending Trail",
      avatarUrl: null,
      handle: "pending-trail",
      provider: "github",
      status: "pending",
    },
    canSync: false,
    isAdmin: false,
  })
}

function setApprovedAuth() {
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
}
