import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"

import {
  makeAccessRequest,
  makeAdminUser,
} from "../../../.storybook/fixtures/admin"

import { AccessRequestList } from "./AccessRequestList"
import { TelegramSettingsCard } from "./TelegramSettingsCard"
import { UserListItem } from "./UserListItem"
import { UsersList } from "./UsersList"

const meta = {
  title: "Administration/Admin components",
  component: AccessRequestList,
  args: { requests: [], onMutate: () => {}, isMutating: null },
  parameters: { layout: "padded" },
} satisfies Meta<typeof AccessRequestList>

export default meta
type Story = StoryObj<typeof meta>

const onMutate = fn()
const onStatus = fn()
const onDelete = fn()
const onSave = fn()
const onTest = fn()

export const AccessRequestsEmpty: Story = {
  render: () => (
    <AccessRequestList requests={[]} onMutate={onMutate} isMutating={null} />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No requests yet.")).toBeVisible()
  },
}

export const AccessRequestsPending: Story = {
  render: () => (
    <AccessRequestList
      requests={[
        makeAccessRequest(),
        makeAccessRequest({ id: "request-fixture-2", identity: null }),
      ]}
      onMutate={onMutate}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    onMutate.mockClear()
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Approve" })[0]!
    )
    await expect(onMutate).toHaveBeenCalledWith(
      "/api/admin/requests/request-fixture-1",
      "PATCH",
      { decision: "approve" }
    )
  },
}

export const AccessRequestNotificationFailure: Story = {
  render: () => (
    <AccessRequestList
      requests={[
        makeAccessRequest({
          notificationStatus: "failed",
          notificationAttemptedAt: Date.parse("2026-09-15T08:00:00.000Z"),
        }),
      ]}
      onMutate={onMutate}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    onMutate.mockClear()
    await userEvent.click(canvas.getByRole("button", { name: "Resend" }))
    await expect(onMutate).toHaveBeenCalledWith(
      "/api/admin/requests/request-fixture-1/resend-notification",
      "POST"
    )
  },
}

export const AccessRequestsMutating: Story = {
  render: () => (
    <AccessRequestList
      requests={[makeAccessRequest()]}
      onMutate={onMutate}
      isMutating="/api/admin/requests/request-fixture-1"
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Approve" })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "Reject" })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "Resend" })).toBeDisabled()
  },
}

export const AccessRequestHistory: Story = {
  render: () => (
    <AccessRequestList
      requests={[
        makeAccessRequest({ status: "approved", notificationStatus: "sent" }),
        makeAccessRequest({
          id: "request-rejected",
          status: "rejected",
          notificationStatus: "failed",
        }),
      ]}
      onMutate={onMutate}
      isMutating={null}
    />
  ),
}

export const UserAllowed: Story = {
  render: () => (
    <UserListItem
      user={makeAdminUser({ status: "allowed" })}
      canDelete
      isMutating={false}
      onStatus={onStatus}
      onDelete={onDelete}
    />
  ),
  play: async ({ canvas }) => {
    onStatus.mockClear()
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Change Alex Trail's status" })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "blocked" })
    )
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("listbox")
      ).not.toBeInTheDocument()
    )
    await expect(onStatus).toHaveBeenCalledWith("blocked")
    await expect(canvas.getByText(/4\.6\s+MB/)).toBeVisible()
  },
}

export const UserPendingWithRequestMetadata: Story = {
  render: () => (
    <UserListItem
      user={makeAdminUser({
        status: "pending",
        identity: "pending@example.test",
        request: makeAccessRequest({ notificationStatus: "failed" }),
      })}
      canDelete
      isMutating={false}
      onStatus={onStatus}
      onDelete={onDelete}
    />
  ),
}

export const UserBlocked: Story = {
  render: () => (
    <UserListItem
      user={makeAdminUser({
        status: "blocked",
        storage: {
          activityCount: 0,
          publicActivityCount: 0,
          activitySizeBytes: 0,
        },
      })}
      canDelete
      isMutating={false}
      onStatus={onStatus}
      onDelete={onDelete}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("0 activities · 0 B")).toBeVisible()
  },
}

export const UserAdminMenuKeyboard: Story = {
  render: () => (
    <UserListItem
      user={makeAdminUser()}
      canDelete
      isMutating={false}
      onStatus={onStatus}
      onDelete={onDelete}
    />
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", {
      name: "Open actions for Alex Trail",
    })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    const deleteAction = await within(document.body).findByRole("button", {
      name: "Delete all user data",
    })
    await expect(deleteAction).toBeVisible()
    await userEvent.click(deleteAction)
    await expect(
      canvas.getByText("Delete all alex@example.test data?")
    ).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Delete permanently" })
    ).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }))
  },
}

export const UsersListComposition: Story = {
  render: () => (
    <UsersList
      users={[
        makeAdminUser(),
        makeAdminUser({
          id: "user-pending",
          displayName: "Bea Pending",
          status: "pending",
        }),
        makeAdminUser({
          id: "user-blocked",
          displayName: "Chris Blocked",
          status: "blocked",
        }),
      ]}
      currentUserId="user-fixture-1"
      onStatus={onStatus}
      onDelete={onDelete}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Users" })).toBeVisible()
    await expect(canvas.getByText("Bea Pending")).toBeVisible()
    await expect(canvas.getByText("Chris Blocked")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Open actions for Alex Trail" })
    ).toBeVisible()
  },
}

export const TelegramUnconfigured: Story = {
  render: () => (
    <TelegramSettingsCard
      chatId={null}
      configured={false}
      onSave={onSave}
      onTest={onTest}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Token not configured; it is never displayed.")
    ).toBeVisible()
  },
}

export const TelegramConfigured: Story = {
  render: () => (
    <TelegramSettingsCard
      chatId="-100123456789"
      configured
      onSave={onSave}
      onTest={onTest}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByDisplayValue("-100123456789")).toBeVisible()
    await expect(
      canvas.getByPlaceholderText("Bot token (leave blank to keep)")
    ).toHaveAttribute("type", "password")
    await expect(canvas.queryByText("secret-token")).not.toBeInTheDocument()
  },
}

export const TelegramDirtySave: Story = {
  render: () => (
    <TelegramSettingsCard
      chatId=""
      configured={false}
      onSave={onSave}
      onTest={onTest}
      isMutating={null}
    />
  ),
  play: async ({ canvas }) => {
    onSave.mockClear()
    await userEvent.type(canvas.getByPlaceholderText("Chat ID"), "123456")
    await userEvent.type(
      canvas.getByPlaceholderText("Bot token (leave blank to keep)"),
      "secret-token"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Save" }))
    await expect(onSave).toHaveBeenCalledWith({
      chatId: "123456",
      token: "secret-token",
    })
    await expect(
      canvas.getByPlaceholderText("Bot token (leave blank to keep)")
    ).toHaveValue("")
  },
}

export const TelegramSaving: Story = {
  render: () => (
    <TelegramSettingsCard
      chatId="123456"
      configured
      onSave={onSave}
      onTest={onTest}
      isMutating="/api/admin/settings/telegram"
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled()
    await expect(
      canvas.getByRole("button", { name: "Send test" })
    ).toBeDisabled()
    await expect(
      canvas.getByRole("button", { name: "Remove token" })
    ).toBeDisabled()
  },
}

export const TelegramSaveError: Story = {
  render: () => <TelegramErrorHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }))
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Could not save Telegram settings."
    )
  },
}

function TelegramErrorHarness() {
  const [error, setError] = useState(false)
  return (
    <>
      <TelegramSettingsCard
        chatId="123456"
        configured
        onSave={() => setError(true)}
        onTest={onTest}
        isMutating={null}
      />
      {error && <p role="alert">Could not save Telegram settings.</p>}
    </>
  )
}
