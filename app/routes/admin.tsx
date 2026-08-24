import { useState } from "react"
import { useLoaderData } from "react-router"
import type { AdminBootstrapResponse } from "~shared/api"
import { PageShell } from "~/components/PageShell"
import { AccessRequestList } from "~/components/admin/AccessRequestList"
import { TelegramSettingsCard } from "~/components/admin/TelegramSettingsCard"
import { UserAccessList } from "~/components/admin/UserAccessList"
import { apiGet, apiSend, friendlyMessage } from "~/lib/server/apiClient"
import { getAuthState, initAuth } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"

export async function clientLoader(): Promise<AdminBootstrapResponse> {
  if (!isServerEnabled) throw new Response("Not found", { status: 404 })
  await initAuth()
  if (getAuthState().status !== "signedIn")
    throw new Response("Not found", { status: 404 })
  try {
    return await apiGet<AdminBootstrapResponse>("/api/admin/bootstrap")
  } catch {
    throw new Response("Not found", { status: 404 })
  }
}

export default function AdminRoute() {
  const [data, setData] = useState(useLoaderData<typeof clientLoader>())
  const [isMutating, setIsMutating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function mutate(path: string, method = "POST", body?: unknown) {
    setIsMutating(path)
    setError(null)
    try {
      await apiSend(method, path, { body })
      setData(await apiGet<AdminBootstrapResponse>("/api/admin/bootstrap"))
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setIsMutating(null)
    }
  }

  return (
    <PageShell title="Administration">
      <div className="space-y-4">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AccessRequestList
          requests={data.requests}
          onMutate={mutate}
          isMutating={isMutating}
        />
        <UserAccessList
          users={data.users}
          isMutating={isMutating}
          onStatus={(id, status) =>
            void mutate(`/api/admin/users/${id}/status`, "PATCH", { status })
          }
        />
        <TelegramSettingsCard
          chatId={data.telegramChatId}
          configured={data.isBotTokenConfigured}
          isMutating={isMutating}
          onSave={(body) =>
            void mutate("/api/admin/settings/telegram", "PATCH", body)
          }
          onTest={() => void mutate("/api/admin/settings/telegram/test")}
        />
      </div>
    </PageShell>
  )
}
