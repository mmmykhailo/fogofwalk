import type { AdminUser, UserStatus } from "~shared/api"
import { UserListItem } from "./UserListItem"

interface UsersListProps {
  users: AdminUser[]
  currentUserId: string | null
  onStatus: (id: string, status: UserStatus) => void
  onDelete: (id: string) => void
  isMutating: string | null
}

export function UsersList({
  users,
  currentUserId,
  onStatus,
  onDelete,
  isMutating,
}: UsersListProps) {
  return (
    <section className="space-y-2 rounded-none p-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">Users</h2>
      {users.map((user) => (
        <UserListItem
          key={user.id}
          user={user}
          canDelete={user.id !== currentUserId}
          isMutating={isMutating !== null}
          onStatus={(status) => onStatus(user.id, status)}
          onDelete={() => onDelete(user.id)}
        />
      ))}
    </section>
  )
}
