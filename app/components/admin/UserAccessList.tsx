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
export function UserAccessList({ users, onStatus, isMutating }: Props) {
  return (
    <section className="space-y-2 rounded-none p-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">Users</h2>
      {users.map((user) => (
        <div
          key={user.id}
          className="flex items-center justify-between gap-3 border-t pt-2 text-xs"
        >
          <p>
            {user.displayName}{" "}
            <span className="text-muted-foreground">{user.identity}</span>
          </p>
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
