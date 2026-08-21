import { useState } from "react"
import { useIsMobile } from "~/lib/useIsMobile"
import { Link } from "react-router"
import {
  ImageIcon,
  TrashIcon,
  ChartBarIcon,
  QuestionIcon,
  CaretRightIcon,
  PlusIcon,
  MapTrifoldIcon,
  PathIcon,
  CloudIcon,
  GlobeIcon,
  MountainsIcon,
  NavigationArrowIcon,
  XIcon,
  UserIcon,
} from "@phosphor-icons/react"
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
  DrawerDescription,
} from "~/components/ui/drawer"
import { Item, ItemContent, ItemMedia, ItemTitle } from "~/components/ui/item"
import { Switch } from "~/components/ui/switch"
import { Button } from "~/components/ui/button"
import { ClearAllDialog } from "~/components/ClearAllDialog"
import { AccountDrawerItem } from "~/components/account/AccountDrawerItem"
import { AccountDialog } from "~/components/account/AccountDialog"
import { SignInDialog } from "~/components/account/SignInDialog"
import { useAuth } from "~/lib/server/authStore"
import type { FogMode, MapMode } from "~/types/tracks"

interface MoreDrawerProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  trackCount: number
  photoCount: number
  isProcessing: boolean
  processedCount: number
  showAddPhotosOption: boolean
  onAddFiles: () => void
  onAddPhotos: () => void
  onClearAll: () => void
  showTracks: boolean
  onShowTracksChange: (v: boolean) => void
  showFog: boolean
  onShowFogChange: (v: boolean) => void
  fogMode: FogMode
  onFogModeChange: (mode: FogMode) => void
  mapMode: MapMode
  onMapModeChange: (mode: MapMode) => void
  showPhotos: boolean
  onShowPhotosChange: (v: boolean) => void
  showMyLocation: boolean
  onShowMyLocationChange: (v: boolean) => void
  locationPermissionDenied: boolean
}

export function MoreDrawer({
  isOpen,
  onOpenChange,
  trackCount,
  photoCount,
  isProcessing,
  processedCount,
  showAddPhotosOption,
  onAddFiles,
  onAddPhotos,
  onClearAll,
  showTracks,
  onShowTracksChange,
  showFog,
  onShowFogChange,
  fogMode,
  onFogModeChange,
  mapMode,
  onMapModeChange,
  showPhotos,
  onShowPhotosChange,
  showMyLocation,
  onShowMyLocationChange,
  locationPermissionDenied,
}: MoreDrawerProps) {
  const close = () => onOpenChange(false)
  const [isClearAllOpen, setIsClearAllOpen] = useState(false)
  const [isSignInOpen, setIsSignInOpen] = useState(false)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [isLocationHintOpen, setIsLocationHintOpen] = useState(false)
  const isMobile = useIsMobile()
  const auth = useAuth()

  /**
   * Close the drawer before opening a dialog, then wait out the close
   * animation. Base UI popups portal outside vaul's Radix focus scope, so
   * overlapping the two fights over focus — see the drawer note in CLAUDE.md.
   */
  const closeThenOpen = (open: (v: boolean) => void) => {
    close()
    setTimeout(() => open(true), 300)
  }

  return (
    <>
      <Drawer
        open={isOpen}
        onOpenChange={onOpenChange}
        direction={isMobile ? "bottom" : "right"}
      >
        <DrawerContent className="overflow-hidden">
          <DrawerTitle className="sr-only">Menu</DrawerTitle>
          <DrawerDescription className="sr-only">
            App settings, file actions, and account options
          </DrawerDescription>
          {!isMobile && (
            <div className="flex shrink-0 items-center justify-end border-b border-foreground/10 px-3 py-2">
              <DrawerClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <XIcon weight="bold" />
                </Button>
              </DrawerClose>
            </div>
          )}
          <div
            className={
              isMobile
                ? "min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-2 pb-8"
                : "min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            }
          >
            {/* 1. File actions */}
            <div className="overflow-hidden ring-1 ring-foreground/10">
              <Item
                variant="muted"
                render={<button type="button" disabled={isProcessing} />}
                onClick={() => {
                  close()
                  setTimeout(onAddFiles, 250)
                }}
                className="active:brightness-95 disabled:opacity-40"
              >
                <ItemMedia variant="icon">
                  <PlusIcon
                    weight="bold"
                    className="size-5 text-muted-foreground"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {isProcessing
                      ? `Processing ${processedCount} of ${trackCount}…`
                      : "Add files"}
                  </ItemTitle>
                </ItemContent>
              </Item>
              {showAddPhotosOption && (
                <>
                  <div className="border-t border-foreground/10" />
                  <Item
                    variant="muted"
                    render={<button type="button" />}
                    onClick={() => {
                      close()
                      setTimeout(onAddPhotos, 250)
                    }}
                    className="active:brightness-95"
                  >
                    <ItemMedia variant="icon">
                      <ImageIcon
                        weight="duotone"
                        className="size-5 text-muted-foreground"
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>Add photos</ItemTitle>
                    </ItemContent>
                  </Item>
                </>
              )}
            </div>

            {/* 2. Toggles */}
            <div className="divide-y divide-foreground/10 overflow-hidden ring-1 ring-foreground/10">
              <div className="flex items-center px-3 py-2.5">
                <MapTrifoldIcon
                  weight="duotone"
                  className="mr-3 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-sm">Show tracks</span>
                <Switch
                  checked={showTracks}
                  onCheckedChange={onShowTracksChange}
                  aria-label="Show tracks"
                />
              </div>
              <div className="flex items-center px-3 py-2.5">
                <CloudIcon
                  weight="duotone"
                  className="mr-3 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-sm">Show fog</span>
                <Switch
                  checked={showFog}
                  onCheckedChange={onShowFogChange}
                  aria-label="Show fog"
                />
              </div>
              <div className="flex items-center px-3 py-2.5">
                <PathIcon
                  weight="duotone"
                  className="mr-3 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-sm">Fill loops</span>
                <Switch
                  checked={fogMode === "fill"}
                  onCheckedChange={(checked) =>
                    onFogModeChange(checked ? "fill" : "corridor")
                  }
                  aria-label="Fill loops"
                />
              </div>
              {photoCount > 0 && (
                <div className="flex items-center px-3 py-2.5">
                  <ImageIcon
                    weight="duotone"
                    className="mr-3 size-5 shrink-0 text-muted-foreground"
                  />
                  <span className="flex-1 text-sm">Show photos</span>
                  <Switch
                    checked={showPhotos}
                    onCheckedChange={onShowPhotosChange}
                    aria-label="Show photos"
                  />
                </div>
              )}
              <div className="flex items-center px-3 py-2.5">
                <NavigationArrowIcon
                  weight="duotone"
                  className="mr-3 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-sm">Show my location</span>
                <div className="relative">
                  {isLocationHintOpen && (
                    <div className="absolute right-0 bottom-full z-10 mb-2 w-max rounded bg-foreground px-2 py-1 text-xs text-nowrap text-background shadow-md">
                      Location permission denied
                    </div>
                  )}
                  <Switch
                    checked={showMyLocation}
                    onCheckedChange={(checked) => {
                      if (locationPermissionDenied) {
                        setIsLocationHintOpen(true)
                        setTimeout(() => setIsLocationHintOpen(false), 2500)
                        return
                      }
                      onShowMyLocationChange(checked)
                    }}
                    className={
                      locationPermissionDenied
                        ? "cursor-pointer opacity-50"
                        : undefined
                    }
                    aria-label="Show my location"
                  />
                </div>
              </div>
              <div className="flex items-center px-3 py-2.5">
                <GlobeIcon
                  weight="duotone"
                  className="mr-3 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-sm">Map style</span>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant={mapMode === "flat" ? "default" : "ghost"}
                    className="h-6 w-6"
                    onClick={() => onMapModeChange("flat")}
                    title="Standard"
                  >
                    <GlobeIcon size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant={mapMode === "relief" ? "default" : "ghost"}
                    className="h-6 w-6"
                    onClick={() => onMapModeChange("relief")}
                    title="Terrain"
                  >
                    <MountainsIcon size={13} />
                  </Button>
                </div>
              </div>
            </div>

            {/* 3. Navigation */}
            <div className="overflow-hidden ring-1 ring-foreground/10">
              <AccountDrawerItem
                onSignIn={() => closeThenOpen(setIsSignInOpen)}
                onOpenAccount={() => closeThenOpen(setIsAccountOpen)}
              />
              <Item
                variant="muted"
                render={<Link to="/tracks" />}
                onClick={close}
              >
                <ItemMedia variant="icon">
                  <PathIcon
                    weight="duotone"
                    className="size-5 text-muted-foreground"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>My tracks</ItemTitle>
                </ItemContent>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Item>
              <div className="ml-10 border-t border-foreground/10" />
              {auth.status === "signedIn" && auth.user.handle && (
                <>
                  <Item
                    variant="muted"
                    render={<Link to={`/u/${auth.user.handle}`} />}
                    onClick={close}
                  >
                    <ItemMedia variant="icon">
                      <UserIcon
                        weight="duotone"
                        className="size-5 text-muted-foreground"
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>My public profile</ItemTitle>
                    </ItemContent>
                    <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </Item>
                  <div className="ml-10 border-t border-foreground/10" />
                </>
              )}
              <Item
                variant="muted"
                render={<Link to="/stats" />}
                onClick={close}
              >
                <ItemMedia variant="icon">
                  <ChartBarIcon
                    weight="duotone"
                    className="size-5 text-muted-foreground"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Statistics</ItemTitle>
                </ItemContent>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Item>
              <div className="ml-10 border-t border-foreground/10" />
              <Item
                variant="muted"
                render={<Link to="/help" />}
                onClick={close}
              >
                <ItemMedia variant="icon">
                  <QuestionIcon
                    weight="duotone"
                    className="size-5 text-muted-foreground"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Help</ItemTitle>
                </ItemContent>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Item>
            </div>

            {/* 4. Destructive — isolated from file actions */}
            {trackCount > 0 && (
              <div className="overflow-hidden ring-1 ring-foreground/10">
                <Item
                  variant="muted"
                  render={<button type="button" disabled={isProcessing} />}
                  onClick={() => {
                    close()
                    setTimeout(() => setIsClearAllOpen(true), 300)
                  }}
                  className="text-destructive active:brightness-95 disabled:opacity-40"
                >
                  <ItemMedia variant="icon">
                    <TrashIcon weight="duotone" className="size-5" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Clear all</ItemTitle>
                  </ItemContent>
                </Item>
              </div>
            )}

            {/* 5. Status */}
            {(isProcessing || trackCount > 0 || photoCount > 0) && (
              <p
                data-testid="drawer-status"
                className="py-1 text-center text-xs text-muted-foreground"
              >
                {isProcessing
                  ? `Processing ${processedCount} of ${trackCount}…`
                  : [
                      trackCount > 0 &&
                        `${trackCount} track${trackCount !== 1 ? "s" : ""}`,
                      photoCount > 0 &&
                        `${photoCount} photo${photoCount !== 1 ? "s" : ""}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <ClearAllDialog
        open={isClearAllOpen}
        onOpenChange={setIsClearAllOpen}
        trackCount={trackCount}
        photoCount={photoCount}
        onConfirm={onClearAll}
      />

      <SignInDialog open={isSignInOpen} onOpenChange={setIsSignInOpen} />
      <AccountDialog open={isAccountOpen} onOpenChange={setIsAccountOpen} />
    </>
  )
}
