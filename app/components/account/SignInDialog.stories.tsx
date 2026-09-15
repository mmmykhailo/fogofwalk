import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import type { AuthProviderInfo } from "~shared/api"
import {
  expect,
  fireEvent,
  fn,
  mocked,
  userEvent,
  waitFor,
  within,
} from "storybook/test"

import { beginSignIn, fetchProviders } from "~/lib/server/authStore"
import { pingServer, useServerHealth } from "~/lib/server/serverHealth"

import { SignInDialog } from "./SignInDialog"

const meta = {
  title: "Account/SignInDialog",
  component: SignInDialog,
  args: { open: true, onOpenChange: fn() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SignInDialog>

export default meta
type Story = StoryObj<typeof meta>

const onBeginSignIn = fn()

const githubProvider: AuthProviderInfo = { id: "github", label: "GitHub" }
const fakeProvider: AuthProviderInfo = { id: "fake", label: "Local test user" }

export const ProviderLoading: Story = {
  render: () => {
    setHealth("online")
    mocked(fetchProviders).mockImplementation(() => new Promise(() => {}))
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    await expect(within(document.body).getByText("Sign in")).toBeVisible()
  },
}

export const GitHubProvider: Story = {
  render: () => {
    setHealth("online")
    setProviders([githubProvider])
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    onBeginSignIn.mockClear()
    mockBeginSignIn()
    await userEvent.click(
      await within(document.body).findByRole("button", {
        name: "Continue with GitHub",
      })
    )
    await expect(onBeginSignIn).toHaveBeenCalledWith("github", undefined)
  },
}

export const MultipleProvidersIncludingFake: Story = {
  render: () => {
    setHealth("online")
    setProviders([
      githubProvider,
      fakeProvider,
      { id: "google", label: "Google" },
    ])
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    onBeginSignIn.mockClear()
    mockBeginSignIn()
    const input = await within(document.body).findByRole("textbox", {
      name: "Local test-user name",
    })
    await fireEvent.change(input, { target: { value: "  Ada Lovelace  " } })
    const form = input.closest("form")
    if (!form) throw new Error("Expected the fake-provider form")
    await fireEvent.submit(form)
    await expect(onBeginSignIn).toHaveBeenCalledWith("fake", "Ada Lovelace")
    await expect(
      within(document.body).getByRole("button", {
        name: "Continue with GitHub",
      })
    ).toBeVisible()
  },
}

export const NoProvidersConfigured: Story = {
  render: () => {
    setHealth("online")
    setProviders([])
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    await expect(
      await within(document.body).findByText(
        "The server has no sign-in providers configured yet."
      )
    ).toBeVisible()
  },
}

export const ServerUnavailable: Story = {
  render: () => {
    setHealth("offline")
    mocked(fetchProviders).mockImplementation(() => new Promise(() => {}))
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    await expect(
      await within(document.body).findByText("Server unavailable")
    ).toBeVisible()
    await expect(
      within(document.body).getByText(/Can't reach the sync server/)
    ).toBeVisible()
  },
}

export const ProviderFetchFailure: Story = {
  render: () => {
    setHealth("online")
    mocked(fetchProviders).mockRejectedValue(
      new Error("Provider lookup failed")
    )
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    await expect(
      await within(document.body).findByText("Provider lookup failed")
    ).toBeVisible()
  },
}

export const RetryAfterServerFailure: Story = {
  render: () => {
    setHealth("offline")
    mocked(fetchProviders)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ providers: [githubProvider] })
    mocked(pingServer).mockResolvedValue(true)
    return <SignInDialog open onOpenChange={() => {}} />
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Try again" })
    )
    await expect(
      await within(document.body).findByRole("button", {
        name: "Continue with GitHub",
      })
    ).toBeVisible()
    await expect(pingServer).toHaveBeenCalledTimes(1)
  },
}

export const CloseRestoresFocus: Story = {
  render: () => {
    setHealth("online")
    setProviders([])
    return <SignInDialogHarness />
  },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Open sign-in dialog" })
    await userEvent.click(trigger)
    await expect(
      await within(document.body).findByRole("dialog", { name: "Sign in" })
    ).toBeVisible()
    await userEvent.click(
      await within(document.body).findByRole("button", { name: "Close" })
    )
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

function SignInDialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sign-in dialog
      </button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function setHealth(value: "unknown" | "online" | "offline") {
  mocked(useServerHealth).mockReturnValue(value)
}

function setProviders(providers: AuthProviderInfo[]) {
  mocked(fetchProviders).mockResolvedValue({ providers })
}

function mockBeginSignIn() {
  mocked(beginSignIn).mockImplementation((providerId, fakeName) => {
    onBeginSignIn(providerId, fakeName)
  })
}
