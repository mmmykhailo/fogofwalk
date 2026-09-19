import { useState, type ComponentProps } from "react"
import { useLocation } from "react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  expect,
  fireEvent,
  fn,
  mocked,
  userEvent,
  waitFor,
  within,
} from "storybook/test"

import { makeServerUser } from "../../.storybook/fixtures/auth"
import { useAuth } from "~/lib/server/authStore"
import { useServerHealth } from "~/lib/server/serverHealth"
import { useUploadHoldSeconds } from "~/lib/server/uploadGate"
import { useFogStatus } from "~/lib/mapStore"
import { Button } from "./ui/button"
import { MapDrawer } from "./MapDrawer"

const meta = {
  title: "Map controls/MapDrawer",
  component: MapDrawer,
  args: makeDrawerProps(),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MapDrawer>

export default meta
type Story = StoryObj<typeof meta>
type DrawerProps = ComponentProps<typeof MapDrawer>

export const EmptyServerless: Story = {
  render: () => {
    setServerless()
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

export const TrailToggleAvailable: Story = {
  render: () => {
    setServerless()
    return (
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({ onShowTrailsChange })}
      />
    )
  },
  play: async () => {
    const drawer = within(document.body)
    await userEvent.click(
      await drawer.findByRole("button", { name: "Open drawer" })
    )
    const trailSwitch = await drawer.findByRole("switch", {
      name: "Show trails",
    })
    await expect(trailSwitch).toBeChecked()
    await userEvent.click(trailSwitch)
    await expect(onShowTrailsChange).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "none" })
    )
    await userEvent.click(await drawer.findByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
  },
}

export const PopulatedWithPhotosAndSavedPoints: Story = {
  render: () => {
    setServerless()
    return (
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({
          activityCount: 8,
          photoCount: 14,
          savedPointCount: 5,
          showAddPhotosOption: true,
          showPhotos: true,
          showSavedPoints: true,
        })}
      />
    )
  },
}

export const ActivitiesOnly: Story = {
  render: () => {
    setServerless()
    return (
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({ activityCount: 8 })}
      />
    )
  },
}

export const PhotosOnly: Story = {
  render: () => {
    setServerless()
    return (
      <MapDrawerStoryHarness drawerProps={makeDrawerProps({ photoCount: 4 })} />
    )
  },
}

export const Processing: Story = {
  render: () => {
    setServerless()
    mocked(useFogStatus).mockReturnValue(fogStatus("processing"))
    return (
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({
          activityCount: 8,
          photoCount: 2,
          isProcessing: true,
          showAddPhotosOption: true,
        })}
      />
    )
  },
}

export const LocationDenied: Story = {
  render: () => {
    setServerless()
    return (
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({ locationPermissionDenied: true })}
      />
    )
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open drawer" })
    )
    await userEvent.click(
      await within(document.body).findByRole("switch", {
        name: "Show my location",
      })
    )
    await expect(
      await within(document.body).findByText("Location permission denied")
    ).toBeVisible()
    await expect(onShowMyLocationChange).not.toHaveBeenCalled()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
  },
}

export const SignedOutServerBuild: Story = {
  render: () => {
    setSignedOut()
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

export const SignedInApproved: Story = {
  render: () => {
    setApproved()
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

export const SignedInAdmin: Story = {
  render: () => {
    setApproved(true)
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

export const PhoneBottomDrawer: Story = {
  parameters: { viewport: { defaultViewport: "phone" } },
  render: () => {
    setServerless()
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

export const DesktopRightDrawer: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => {
    setServerless()
    return <MapDrawerStoryHarness drawerProps={makeDrawerProps()} />
  },
}

const onAddFiles = fn()
const onAddPhotos = fn()
const onClearActivities = fn()
const onClearPhotos = fn()
const onShowActivitiesChange = fn()
const onShowTrailsChange = fn()
const onShowFogChange = fn()
const onFogModeChange = fn()
const onMapModeChange = fn()
const onShowPhotosChange = fn()
const onShowSavedPointsChange = fn()
const onShowMyLocationChange = fn()

export const TogglesActionsAndNestedClear: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => {
    setServerless()
    return <DrawerInteractionHarness />
  },
  play: async () => {
    const drawer = within(document.body)
    await userEvent.click(
      await drawer.findByRole("button", { name: "Open drawer" })
    )
    fireEvent.click(
      await drawer.findByRole("switch", { name: "Show activities" })
    )
    fireEvent.click(await drawer.findByRole("switch", { name: "Show trails" }))
    fireEvent.click(await drawer.findByRole("switch", { name: "Show fog" }))
    fireEvent.click(await drawer.findByRole("switch", { name: "Fill loops" }))
    fireEvent.click(await drawer.findByRole("switch", { name: "Show photos" }))
    fireEvent.click(
      await drawer.findByRole("switch", { name: "Show saved points" })
    )
    fireEvent.click(
      await drawer.findByRole("switch", { name: "Show my location" })
    )
    fireEvent.click(await drawer.findByRole("button", { name: "Terrain" }))
    const switchEvent = expect.objectContaining({ reason: "none" })
    await expect(onShowActivitiesChange).toHaveBeenCalledWith(
      false,
      switchEvent
    )
    await expect(onShowTrailsChange).toHaveBeenCalledWith(false, switchEvent)
    await expect(onShowFogChange).toHaveBeenCalledWith(false, switchEvent)
    await expect(onFogModeChange).toHaveBeenCalledWith("fill")
    await expect(onMapModeChange).toHaveBeenCalledWith("relief")
    await expect(onShowPhotosChange).toHaveBeenCalledWith(false, switchEvent)
    await expect(onShowSavedPointsChange).toHaveBeenCalledWith(
      false,
      switchEvent
    )
    await expect(onShowMyLocationChange).toHaveBeenCalledWith(false)

    fireEvent.click(await drawer.findByRole("button", { name: "Add photos" }))
    await waitFor(() => expect(onAddPhotos).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })
    await userEvent.click(
      await drawer.findByRole("button", { name: "Open drawer" })
    )
    await userEvent.click(
      await drawer.findByRole("button", { name: "Clear activities" })
    )
    const activityDialog = await within(document.body).findByRole("dialog", {
      name: "Clear activities?",
    })
    await userEvent.click(
      within(activityDialog).getByRole("button", { name: "Clear activities" })
    )
    await waitFor(() => expect(onClearActivities).toHaveBeenCalledTimes(1))
    await expect(onClearPhotos).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )

    await userEvent.click(
      await drawer.findByRole("button", { name: "Open drawer" })
    )
    await userEvent.click(
      await drawer.findByRole("button", { name: "Clear photos" })
    )
    const photoDialog = await within(document.body).findByRole("dialog", {
      name: "Clear photos?",
    })
    await userEvent.click(
      within(photoDialog).getByRole("button", { name: "Clear photos" })
    )
    await waitFor(() => expect(onClearPhotos).toHaveBeenCalledTimes(1))
    await expect(onClearActivities).toHaveBeenCalledTimes(1)
  },
}

export const Navigation: Story = {
  render: () => {
    setServerless()
    return <NavigationHarness />
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open drawer" })
    )
    await userEvent.click(
      await within(document.body).findByRole("link", { name: "My activities" })
    )
    await waitFor(() =>
      expect(canvas.getByTestId("map-drawer-location")).toHaveTextContent(
        "/activities"
      )
    )
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
  },
}

function MapDrawerStoryHarness({ drawerProps }: { drawerProps: DrawerProps }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      {!isOpen && <Button onClick={() => setIsOpen(true)}>Open drawer</Button>}
      <MapDrawer {...drawerProps} isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  )
}

function DrawerInteractionHarness() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {!isOpen && <Button onClick={() => setIsOpen(true)}>Open drawer</Button>}
      <MapDrawer
        {...makeDrawerProps({
          isOpen,
          onOpenChange: setIsOpen,
          activityCount: 4,
          photoCount: 3,
          savedPointCount: 2,
          showAddPhotosOption: true,
          onShowActivitiesChange,
          onShowTrailsChange,
          onShowFogChange,
          onFogModeChange,
          onMapModeChange,
          onAddFiles,
          onAddPhotos: () => {
            onAddPhotos()
          },
          onClearActivities,
          onClearPhotos,
          onShowPhotosChange,
          onShowSavedPointsChange,
          onShowMyLocationChange,
        })}
      />
    </>
  )
}

function NavigationHarness() {
  const location = useLocation()
  return (
    <>
      <MapDrawerStoryHarness
        drawerProps={makeDrawerProps({ onOpenChange: () => {} })}
      />
      <output data-testid="map-drawer-location" className="sr-only">
        {location.pathname}
      </output>
    </>
  )
}

function makeDrawerProps(overrides: Partial<DrawerProps> = {}): DrawerProps {
  return {
    isOpen: false,
    onOpenChange: () => {},
    activityCount: 0,
    photoCount: 0,
    isProcessing: false,
    showAddPhotosOption: false,
    onAddFiles: () => {},
    onAddPhotos: () => {},
    onClearActivities: () => {},
    onClearPhotos: () => {},
    showActivities: true,
    onShowActivitiesChange: () => {},
    showTrails: true,
    onShowTrailsChange: () => {},
    showFog: true,
    onShowFogChange: () => {},
    fogMode: "corridor",
    onFogModeChange: () => {},
    mapMode: "flat",
    onMapModeChange: () => {},
    showPhotos: true,
    onShowPhotosChange: () => {},
    savedPointCount: 0,
    showSavedPoints: true,
    onShowSavedPointsChange: () => {},
    showMyLocation: true,
    onShowMyLocationChange: () => {},
    locationPermissionDenied: false,
    ...overrides,
  }
}

function setServerless() {
  mocked(useAuth).mockReturnValue({ status: "disabled" })
  mocked(useServerHealth).mockReturnValue("unknown")
  mocked(useUploadHoldSeconds).mockReturnValue(null)
  mocked(useFogStatus).mockReturnValue(fogStatus("idle"))
}

function setSignedOut() {
  mocked(useAuth).mockReturnValue({ status: "signedOut" })
  mocked(useServerHealth).mockReturnValue("online")
  mocked(useUploadHoldSeconds).mockReturnValue(null)
  mocked(useFogStatus).mockReturnValue(fogStatus("idle"))
}

function setApproved(admin = false) {
  mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: makeServerUser(),
    canSync: true,
    isAdmin: admin,
  })
  mocked(useServerHealth).mockReturnValue("online")
  mocked(useUploadHoldSeconds).mockReturnValue(null)
  mocked(useFogStatus).mockReturnValue(fogStatus("idle"))
}

function fogStatus(phase: "idle" | "processing") {
  return {
    phase,
    requestId: phase === "processing" ? "story-fog" : null,
    generation: 1,
    libraryRevision: 1,
    coverageRevision: 1,
    mode: "corridor" as const,
    processed: phase === "processing" ? 3 : 0,
    total: phase === "processing" ? 8 : 0,
    error: null,
    warnings: [],
    recoveryAttempts: 0,
    retryable: false,
    warningCounts: {},
    errorCounts: {},
    infoCounts: {},
    coverageReducedCounts: {},
    normalizedActivityCount: 0,
    coverageReducedActivityCount: 0,
    repairedActivityCount: 0,
    rejectedActivityCount: 0,
    geometryFallbackCount: 0,
  }
}
