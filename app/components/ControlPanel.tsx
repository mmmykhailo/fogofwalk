import { useRef, useState } from "react"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"
import type { FogMode, MapMode } from "~/types/activities"
import { MapDrawer } from "~/components/MapDrawer"
import { FogProgressIndicator } from "~/components/FogProgress"

interface ControlPanelProps {
  activityCount: number
  isProcessing: boolean
  showActivities: boolean
  onShowActivitiesChange: (value: boolean) => void
  showFog: boolean
  onShowFogChange: (value: boolean) => void
  fogMode: FogMode
  onFogModeChange: (mode: FogMode) => void
  mapMode: MapMode
  onMapModeChange: (mode: MapMode) => void
  onAddFiles: (files: FileList) => void
  onClearAll: () => void
  photoCount: number
  onAddPhotos: (files: FileList) => void
  showPhotos: boolean
  onShowPhotosChange: (value: boolean) => void
  savedPointCount: number
  showSavedPoints: boolean
  onShowSavedPointsChange: (value: boolean) => void
  showMyLocation: boolean
  onShowMyLocationChange: (value: boolean) => void
  locationPermissionDenied: boolean
}

export function ControlPanel({
  activityCount,
  isProcessing,
  showActivities,
  onShowActivitiesChange,
  showFog,
  onShowFogChange,
  fogMode,
  onFogModeChange,
  mapMode,
  onMapModeChange,
  onAddFiles,
  onClearAll,
  photoCount,
  onAddPhotos,
  showPhotos,
  onShowPhotosChange,
  savedPointCount,
  showSavedPoints,
  onShowSavedPointsChange,
  showMyLocation,
  onShowMyLocationChange,
  locationPermissionDenied,
}: ControlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    onAddFiles(files)
    e.target.value = ""
  }

  function handlePhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    onAddPhotos(files)
    e.target.value = ""
  }

  const showAddPhotosOption =
    activityCount > 0 && (showPhotos || photoCount === 0)

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".gpx,.fit"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={photoInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {/* FAB — grouped visually with the compass (top-right) */}
      <div className="absolute top-28 right-1.5 z-10 flex items-center gap-2 sm:right-3">
        {isProcessing && <FogProgressIndicator activityCount={activityCount} />}
        <Button
          variant="outline"
          size="icon"
          className="border-0 bg-background/80 shadow-sm backdrop-blur-md"
          onClick={() => setIsDrawerOpen(true)}
          aria-label="Open controls"
        >
          <DotsThreeIcon weight="bold" size={20} />
        </Button>
      </div>

      {/* All controls in one drawer */}
      <MapDrawer
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        activityCount={activityCount}
        photoCount={photoCount}
        isProcessing={isProcessing}
        showAddPhotosOption={showAddPhotosOption}
        onAddFiles={() => fileInputRef.current?.click()}
        onAddPhotos={() => photoInputRef.current?.click()}
        onClearAll={onClearAll}
        showActivities={showActivities}
        onShowActivitiesChange={onShowActivitiesChange}
        showFog={showFog}
        onShowFogChange={onShowFogChange}
        fogMode={fogMode}
        onFogModeChange={onFogModeChange}
        mapMode={mapMode}
        onMapModeChange={onMapModeChange}
        showPhotos={showPhotos}
        onShowPhotosChange={onShowPhotosChange}
        savedPointCount={savedPointCount}
        showSavedPoints={showSavedPoints}
        onShowSavedPointsChange={onShowSavedPointsChange}
        showMyLocation={showMyLocation}
        onShowMyLocationChange={onShowMyLocationChange}
        locationPermissionDenied={locationPermissionDenied}
      />
    </>
  )
}
