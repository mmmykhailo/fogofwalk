import { useRef, useState } from "react"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { Button } from "~/components/ui/button"
import type { FogMode, MapMode } from "~/types/tracks"
import { MoreDrawer } from "~/components/MoreDrawer"

interface ControlPanelProps {
  trackCount: number
  processedCount: number
  isProcessing: boolean
  showTracks: boolean
  onShowTracksChange: (value: boolean) => void
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
  showMyLocation: boolean
  onShowMyLocationChange: (value: boolean) => void
  locationPermissionDenied: boolean
}

export function ControlPanel({
  trackCount,
  processedCount,
  isProcessing,
  showTracks,
  onShowTracksChange,
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

  const showAddPhotosOption = trackCount > 0 && (showPhotos || photoCount === 0)

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
        {isProcessing && (
          <div className="flex h-8 items-center gap-2 border border-border bg-background/80 px-2.5 backdrop-blur-md">
            <span className="text-xs text-muted-foreground tabular-nums">
              {processedCount}/{trackCount}
            </span>
            <div className="relative h-1 w-20 overflow-hidden bg-muted">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300"
                style={{
                  width: `${trackCount > 0 ? Math.round((processedCount / trackCount) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}
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
      <MoreDrawer
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        trackCount={trackCount}
        photoCount={photoCount}
        isProcessing={isProcessing}
        processedCount={processedCount}
        showAddPhotosOption={showAddPhotosOption}
        onAddFiles={() => fileInputRef.current?.click()}
        onAddPhotos={() => photoInputRef.current?.click()}
        onClearAll={onClearAll}
        showTracks={showTracks}
        onShowTracksChange={onShowTracksChange}
        showFog={showFog}
        onShowFogChange={onShowFogChange}
        fogMode={fogMode}
        onFogModeChange={onFogModeChange}
        mapMode={mapMode}
        onMapModeChange={onMapModeChange}
        showPhotos={showPhotos}
        onShowPhotosChange={onShowPhotosChange}
        showMyLocation={showMyLocation}
        onShowMyLocationChange={onShowMyLocationChange}
        locationPermissionDenied={locationPermissionDenied}
      />
    </>
  )
}
