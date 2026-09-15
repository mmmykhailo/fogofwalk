import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, mocked, userEvent } from "storybook/test"

import { makeServerUser } from "../../../.storybook/fixtures/auth"
import { useAuth, type AuthState } from "~/lib/server/authStore"
import { useSyncStatus, type SyncStatus } from "~/lib/server/syncEngine"
import { useServerHealth, type ServerHealth } from "~/lib/server/serverHealth"
import { useUploadHoldSeconds } from "~/lib/server/uploadGate"

import { AccountDrawerItem } from "./AccountDrawerItem"

const meta = {
  title: "Account/AccountDrawerItem",
  component: AccountDrawerItem,
  args: { onSignIn: fn(), onOpenAccount: fn() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof AccountDrawerItem>

export default meta
type Story = StoryObj<typeof meta>

const onSignIn = fn()
const onOpenAccount = fn()

export const ServerDisabled: Story = {
  render: () => {
    setAccountState({ auth: { status: "disabled" } })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument()
  },
}

export const Loading: Story = {
  render: () => {
    setAccountState({ auth: { status: "loading" }, health: "unknown" })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
}

export const SignedOut: Story = {
  render: () => {
    setAccountState({ auth: { status: "signedOut" }, health: "online" })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeVisible()
  },
}

export const SignedInPendingAccess: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser({ status: "pending" }),
        canSync: false,
        isAdmin: false,
      },
      health: "online",
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("account-row")).toHaveTextContent(
      "Not enabled for sync"
    )
  },
}

export const ApprovedAndSyncing: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: false,
      },
      health: "online",
      sync: syncStatus({ phase: "syncing", done: 3, total: 10 }),
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("account-row")).toHaveTextContent(
      "Syncing 3 of 10"
    )
  },
}

export const UploadHold: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: false,
      },
      health: "online",
      holdSeconds: 42,
      sync: syncStatus({ phase: "syncing", done: 2, total: 20 }),
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("account-row")).toHaveTextContent(
      "Upload limit reached — resuming in 42s"
    )
  },
}

export const OfflineCachedIdentity: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: false,
      },
      health: "offline",
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("account-row")).toHaveTextContent(
      "Offline — will sync later"
    )
  },
}

export const SyncError: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: false,
      },
      health: "online",
      sync: syncStatus({ phase: "error", message: "Server rejected the sync" }),
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("account-row")).toHaveTextContent(
      "Server rejected the sync"
    )
  },
}

export const Administrator: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: true,
      },
      health: "online",
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
}

export const SignedOutAction: Story = {
  render: () => {
    setAccountState({ auth: { status: "signedOut" }, health: "online" })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    onSignIn.mockClear()
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }))
    await expect(onSignIn).toHaveBeenCalledTimes(1)
  },
}

export const SignedInAccountAction: Story = {
  render: () => {
    setAccountState({
      auth: {
        status: "signedIn",
        user: makeAccountUser(),
        canSync: true,
        isAdmin: false,
      },
      health: "online",
    })
    return (
      <AccountDrawerItem onSignIn={onSignIn} onOpenAccount={onOpenAccount} />
    )
  },
  play: async ({ canvas }) => {
    onOpenAccount.mockClear()
    await userEvent.click(canvas.getByTestId("account-row"))
    await expect(onOpenAccount).toHaveBeenCalledTimes(1)
  },
}

function setAccountState({
  auth,
  health = "online",
  holdSeconds = null,
  sync = syncStatus({}),
}: {
  auth: AuthState
  health?: ServerHealth
  holdSeconds?: number | null
  sync?: SyncStatus
}) {
  mocked(useAuth).mockReturnValue(auth)
  mocked(useServerHealth).mockReturnValue(health)
  mocked(useUploadHoldSeconds).mockReturnValue(holdSeconds)
  mocked(useSyncStatus).mockReturnValue(sync)
}

function makeAccountUser(overrides: Parameters<typeof makeServerUser>[0] = {}) {
  return makeServerUser({ avatarUrl: null, ...overrides })
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
