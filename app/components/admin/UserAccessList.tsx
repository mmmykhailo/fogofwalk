import type { AdminUser, UserStatus } from "~shared/api"
import { Button } from "~/components/ui/button"

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
          <div>
            <p>
              {user.displayName}{" "}
              <span className="text-muted-foreground">{user.identity}</span>
            </p>
            <p className="text-muted-foreground">{user.status}</p>
          </div>
          <div className="flex gap-1">
            {(["pending", "allowed", "blocked"] as UserStatus[]).map(
              (status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={user.status === status ? "default" : "outline"}
                  disabled={isMutating !== null || user.status === status}
                  onClick={() => onStatus(user.id, status)}
                >
                  {status}
                </Button>
              )
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
