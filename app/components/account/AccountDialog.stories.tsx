import { useFetcher } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import type { AccessRequest } from "~shared/api"
import { expect, fn, mocked, userEvent, within } from "storybook/test"

import { makeAccessRequest } from "../../../.storybook/fixtures/admin"
import { makeServerUser } from "../../../.storybook/fixtures/auth"
import type { AccessRequestData } from "~/routes/account.access-request"
import { apiGet } from "~/lib/server/apiClient"
import { useAuth } from "~/lib/server/authStore"
import { downloadDiagnostics } from "~/lib/diagnostics"
import { useSyncStatus, type SyncStatus } from "~/lib/server/syncEngine"
import { useServerHealth, type ServerHealth } from "~/lib/server/serverHealth"
import { useUploadHoldSeconds } from "~/lib/server/uploadGate"

import { AccountDialog } from "./AccountDialog"

const onOpenChange = fn()

const meta = {
  title: "Account/AccountDialog",
  component: AccountDialog,
  args: {
    accessRequestFetcher: undefined as never,
    open: true,
    onOpenChange,
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof AccountDialog>

export default meta
type Story = StoryObj<typeof meta>

const exportResponse = {
  account: { id: "user-fixture-1" },
  activities: [],
  savedPoints: [],
}

export const PendingAccessRequest: Story = {
  parameters: {
    router: {
      resources: [
        {
          path: "/account/access-request",
          actionResult: {
            request: makeAccessRequest() as AccessRequest,
            error: null,
          } satisfies AccessRequestData,
        },
      ],
    },
  },
  render: () => {
    setAccountMocks({ canSync: false })
    return <AccountDialogHarness />
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(
      await body.findByRole("button", { name: "Request access" })
    )
    await expect(await body.findByText("Access request pending")).toBeVisible()
  },
}

export const ApprovedSyncAction: Story = {
  render: () => {
    setAccountMocks({ canSync: true })
    return <AccountDialogHarness />
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByTestId("sync-now"))
    await expect(body.getByTestId("sync-now")).toBeVisible()
  },
}

export const OfflineCachedIdentity: Story = {
  render: () => {
    setAccountMocks({ canSync: true, health: "offline" })
    return <AccountDialogHarness />
  },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText("Server unavailable")).toBeVisible()
    await expect(body.getByText("Signed in with github")).toBeVisible()
    await expect(body.queryByTestId("sync-now")).not.toBeInTheDocument()
    await expect(
      body.getByRole("button", { name: "Delete account" })
    ).toBeDisabled()
  },
}

export const DiagnosticsAndDataExport: Story = {
  render: () => {
    setAccountMocks({ canSync: true })
    mocked(apiGet).mockResolvedValue(exportResponse)
    return <AccountDialogHarness />
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(
      await body.findByRole("button", { name: "Export my data" })
    )
    await expect(
      await body.findByRole("button", { name: "Downloaded!" })
    ).toBeVisible()
    await expect(apiGet).toHaveBeenCalledWith("/api/account/export")

    await userEvent.click(body.getByTestId("download-diagnostics"))
    await expect(
      body.getAllByRole("button", { name: "Downloaded!" })
    ).toHaveLength(2)
  },
}

export const DestructiveActionsStayBehindConfirmation: Story = {
  render: () => {
    setAccountMocks({ canSync: true })
    return <AccountDialogHarness />
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(
      await body.findByRole("button", { name: "Remove all" })
    )
    await expect(
      body.getByText("Remove all activities from the server?")
    ).toBeVisible()
    await userEvent.click(body.getByRole("button", { name: "Cancel" }))

    await userEvent.click(body.getByRole("button", { name: "Delete account" }))
    await expect(body.getByText("Delete your account?")).toBeVisible()
    await userEvent.click(body.getByRole("button", { name: "Cancel" }))
  },
}

function AccountDialogHarness() {
  const accessRequestFetcher = useFetcher<AccessRequestData>()
  return (
    <AccountDialog
      accessRequestFetcher={accessRequestFetcher}
      open
      onOpenChange={onOpenChange}
    />
  )
}

function setAccountMocks({
  canSync,
  health = "online",
  sync = syncStatus({}),
}: {
  canSync: boolean
  health?: ServerHealth
  sync?: SyncStatus
}) {
  mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: makeServerUser({ avatarUrl: null }),
    canSync,
    isAdmin: false,
  })
  mocked(useServerHealth).mockReturnValue(health)
  mocked(useUploadHoldSeconds).mockReturnValue(null)
  mocked(useSyncStatus).mockReturnValue(sync)
  mocked(downloadDiagnostics).mockReturnValue(true)
  mocked(apiGet).mockImplementation(async () => ({}) as never)
}

function syncStatus(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    phase: "idle",
    lastSyncAt: null,
    message: null,
    runId: 0,
    trigger: null,
    done: 0,
    total: 0,
    retries: 0,
    nextRetryAt: null,
    pendingCount: 0,
    retryableCount: 0,
    inFlightCount: 0,
    permanentCount: 0,
    cursorHeld: false,
    ...overrides,
  }
}
