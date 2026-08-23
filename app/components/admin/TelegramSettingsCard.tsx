import { useState } from "react"
import { Button } from "~/components/ui/button"

interface Props { chatId: string | null; configured: boolean; onSave: (body: unknown) => void; onTest: () => void; isMutating: string | null }
export function TelegramSettingsCard({ chatId, configured, onSave, onTest, isMutating }: Props) {
  const [nextChatId, setNextChatId] = useState(chatId ?? "")
  const [token, setToken] = useState("")
  return <section className="space-y-3 rounded-none p-4 ring-1 ring-foreground/10"><div><h2 className="font-medium">Telegram</h2><p className="text-xs text-muted-foreground">Token {configured ? "configured" : "not configured"}; it is never displayed.</p></div><input className="w-full border bg-transparent p-2 text-sm" value={nextChatId} onChange={(event) => setNextChatId(event.target.value)} placeholder="Chat ID" /><input className="w-full border bg-transparent p-2 text-sm" type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bot token (leave blank to keep)" /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={isMutating !== null} onClick={() => { onSave({ chatId: nextChatId, ...(token ? { token } : {}) }); setToken("") }}>Save</Button><Button size="sm" variant="outline" disabled={isMutating !== null} onClick={onTest}>Send test</Button><Button size="sm" variant="destructive" disabled={isMutating !== null} onClick={() => onSave({ clearToken: true })}>Remove token</Button></div></section>
}
