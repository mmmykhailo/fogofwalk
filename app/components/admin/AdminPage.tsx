import { useState } from "react"
import type { AdminBootstrapResponse } from "~shared/api"
import { PageShell } from "~/components/PageShell"
import { apiGet, apiSend, friendlyMessage } from "~/lib/server/apiClient"
import { AccessRequestList } from "./AccessRequestList"
import { TelegramSettingsCard } from "./TelegramSettingsCard"
import { UserAccessList } from "./UserAccessList"

export function AdminPage({ initial }: { initial: AdminBootstrapResponse }) {
  const [data, setData] = useState(initial); const [isMutating, setIsMutating] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)
  async function mutate(path: string, method = "POST", body?: unknown) { setIsMutating(path); setError(null); try { await apiSend(method, path, { body }); setData(await apiGet<AdminBootstrapResponse>("/api/admin/bootstrap")) } catch (err) { setError(friendlyMessage(err)) } finally { setIsMutating(null) } }
  return <PageShell title="Administration"><div className="space-y-4">{error && <p className="text-xs text-destructive">{error}</p>}<AccessRequestList requests={data.requests} onMutate={mutate} isMutating={isMutating} /><UserAccessList users={data.users} isMutating={isMutating} onStatus={(id, status) => void mutate(`/api/admin/users/${id}/status`, "PATCH", { status })} /><TelegramSettingsCard chatId={data.telegramChatId} configured={data.isBotTokenConfigured} isMutating={isMutating} onSave={(body) => void mutate("/api/admin/settings/telegram", "PATCH", body)} onTest={() => void mutate("/api/admin/settings/telegram/test")} /></div></PageShell>
}
