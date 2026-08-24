import { useEffect, useState } from "react"
import { DotsThreeVerticalIcon } from "@phosphor-icons/react"
import { Popover } from "@base-ui/react/popover"
import type { AdminUser, UserStatus } from "~shared/api"
import { Button } from "~/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import clsx from "clsx"

interface UserListItemProps {
  user: AdminUser
  canDelete: boolean
  isMutating: boolean
  onStatus: (status: UserStatus) => void
  onDelete: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

export function UserListItem({
  user,
  canDelete,
  isMutating,
  onStatus,
  onDelete,
}: UserListItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleteUnlocked, setIsDeleteUnlocked] = useState(false)

  useEffect(() => {
    if (!isDeleteConfirmOpen) {
      setIsDeleteUnlocked(false)
      return
    }
    const timeout = setTimeout(() => setIsDeleteUnlocked(true), 3000)
    return () => clearTimeout(timeout)
  }, [isDeleteConfirmOpen])

  function openDeleteConfirmation() {
    setIsMenuOpen(false)
    setIsDeleteConfirmOpen(true)
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-3 border-t py-2 text-xs">
        <div className="min-w-0">
          <p>
            {user.displayName}{" "}
            <span className="text-muted-foreground">{user.identity}</span>
          </p>
          <p className="text-muted-foreground">
            {user.storage.trackCount}{" "}
            {user.storage.trackCount === 1 ? "track" : "tracks"} ·{" "}
            {formatBytes(user.storage.trackSizeBytes)}
            {user.storage.publicTrackCount > 0 &&
              ` · ${user.storage.publicTrackCount} public`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={user.status}
            onValueChange={(status) => onStatus(status as UserStatus)}
            disabled={isMutating}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Change ${user.displayName}'s status`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["pending", "allowed", "blocked"] as UserStatus[]).map(
                (status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Popover.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <Popover.Trigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label={`Open actions for ${user.displayName}`}
              disabled={isMutating}
            >
              <DotsThreeVerticalIcon />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                className="z-20"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <Popover.Popup className="relative bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <Button
                    disabled={!canDelete}
                    variant="destructive"
                    size="sm"
                    onClick={openDeleteConfirmation}
                  >
                    Delete all user data
                  </Button>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {isDeleteConfirmOpen && (
          <div className="absolute inset-x-0 top-0 z-10 flex min-h-full items-center justify-between gap-3 bg-popover py-1 pr-2 pl-4 ring-1 ring-destructive/30">
            <div>
              <p className="font-medium text-destructive">
                Delete all {user.identity} data?
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={!isDeleteUnlocked || isMutating}
              >
                {isMutating ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
