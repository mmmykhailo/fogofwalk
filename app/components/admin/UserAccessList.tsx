import type { AdminUser, UserStatus } from "~shared/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"

interface Props {
  users: AdminUser[]
  onStatus: (id: string, status: UserStatus) => void
  isMutating: string | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

export function UserAccessList({ users, onStatus, isMutating }: Props) {
  return (
    <section className="space-y-2 rounded-none p-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">Users</h2>
      {users.map((user) => (
        <div
          key={user.id}
          className="flex items-center justify-between gap-3 border-t pt-2 text-xs"
        >
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
              onValueChange={(status) =>
                onStatus(user.id, status as UserStatus)
              }
              disabled={isMutating !== null}
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
          </div>
        </div>
      ))}
    </section>
  )
}
