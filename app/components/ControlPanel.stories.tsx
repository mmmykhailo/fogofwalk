import { useState, type ComponentProps } from "react"
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

import { useFogStatus } from "~/lib/mapStore"
import { useImportStatus } from "~/lib/activities/import/status"
import type { ImportStatus } from "~/lib/activities/import/status"
import type { FogProjectionStatus } from "~/lib/mapStore"
import { useAuth } from "~/lib/server/authStore"

import { ControlPanel } from "./ControlPanel"

const meta = {
  title: "Map controls/ControlPanel",
  component: ControlPanel,
  args: makeControlPanelProps(),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ControlPanel>

export default meta
type Story = StoryObj<typeof meta>
type ControlPanelProps = ComponentProps<typeof ControlPanel>

export const DefaultFab: Story = {
  render: () => {
    setServerless()
    return <ControlPanel {...makeControlPanelProps()} />
  },
}

export const ProgressAndStatusVisible: Story = {
  render: () => {
    setServerless()
    mocked(useImportStatus).mockReturnValue(importStatus)
    mocked(useFogStatus).mockReturnValue(failedFogStatus)
    return (
      <ControlPanel
        {...makeControlPanelProps({ activityCount: 4, isProcessing: true })}
      />
    )
  },
}

const onAddFiles = fn()

export const OpenDrawerAndSelectFile: Story = {
  render: () => {
    setServerless()
    return <ControlPanelHarness />
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open controls" })
    )
    await expect(within(document.body).getByText("Add files")).toBeVisible()

    const input = canvasElement.querySelector(
      'input[type="file"][accept=".gpx,.fit"]'
    )
    if (!(input instanceof HTMLInputElement))
      throw new Error("Activity file input missing")
    const file = new File(["fixture-gpx"], "story-route.gpx", {
      type: "application/gpx+xml",
    })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    await fireEvent.change(input, { target: { files: dataTransfer.files } })
    await waitFor(() => expect(onAddFiles).toHaveBeenCalledTimes(1))
    await expect(onAddFiles.mock.calls[0]?.[0]).toBe(dataTransfer.files)
  },
}

function ControlPanelHarness() {
  const [showActivities, setShowActivities] = useState(true)
  const [showTrails, setShowTrails] = useState(true)
  const [showFog, setShowFog] = useState(true)
  const [showPhotos, setShowPhotos] = useState(true)
  const [showSavedPoints, setShowSavedPoints] = useState(true)
  const [showMyLocation, setShowMyLocation] = useState(false)
  return (
    <ControlPanel
      {...makeControlPanelProps({
        activityCount: 2,
        photoCount: 1,
        savedPointCount: 1,
        showActivities,
        onShowActivitiesChange: setShowActivities,
        showTrails,
        onShowTrailsChange: setShowTrails,
        showFog,
        onShowFogChange: setShowFog,
        showPhotos,
        onShowPhotosChange: setShowPhotos,
        showSavedPoints,
        onShowSavedPointsChange: setShowSavedPoints,
        showMyLocation,
        onShowMyLocationChange: setShowMyLocation,
        onAddFiles,
      })}
    />
  )
}

function makeControlPanelProps(
  overrides: Partial<ControlPanelProps> = {}
): ControlPanelProps {
  return {
    activityCount: 0,
    isProcessing: false,
    showActivities: true,
    onShowActivitiesChange: () => {},
    showTrails: true,
    onShowTrailsChange: () => {},
    showFog: true,
    onShowFogChange: () => {},
    fogMode: "corridor",
    onFogModeChange: () => {},
    onRetryFog: () => {},
    mapMode: "flat",
    onMapModeChange: () => {},
    onAddFiles: () => {},
    onClearActivities: () => {},
    onClearPhotos: () => {},
    photoCount: 0,
    onAddPhotos: () => {},
    showPhotos: true,
    onShowPhotosChange: () => {},
    savedPointCount: 0,
    showSavedPoints: true,
    onShowSavedPointsChange: () => {},
    showMyLocation: false,
    onShowMyLocationChange: () => {},
    locationPermissionDenied: false,
    ...overrides,
  }
}

function setServerless() {
  mocked(useAuth).mockReturnValue({ status: "disabled" })
  mocked(useImportStatus).mockReturnValue(idleImportStatus)
  mocked(useFogStatus).mockReturnValue(idleFogStatus)
}

const idleImportStatus: ImportStatus = {
  phase: "idle",
  operationId: null,
  completedFiles: 0,
  totalFiles: 0,
  fileStages: {},
  isSaveStageVisible: false,
  savedFileIndexes: {},
  isVisible: false,
  result: null,
  error: null,
}

const importStatus: ImportStatus = {
  phase: "running",
  operationId: "story-import",
  completedFiles: 2,
  totalFiles: 4,
  fileStages: { 0: "ready", 1: "parsing", 2: "reading", 3: "queued" },
  isSaveStageVisible: false,
  savedFileIndexes: {},
  isVisible: true,
  result: null,
  error: null,
}

const idleFogStatus: FogProjectionStatus = {
  phase: "idle",
  requestId: null,
  generation: 0,
  libraryRevision: 0,
  coverageRevision: 0,
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
  coverageReducedActivityCount: 0,
  repairedActivityCount: 0,
  rejectedActivityCount: 0,
  geometryFallbackCount: 0,
}

const failedFogStatus: FogProjectionStatus = {
  ...idleFogStatus,
  phase: "failed",
  requestId: "story-fog",
  error: "Fog processing failed for this preview.",
  retryable: true,
}
