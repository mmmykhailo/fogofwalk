import { env } from "./env"
import type { ServerStore } from "./store/types"

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const salt = encoder.encode("fogofwalk/telegram-token/v1/salt")
const info = encoder.encode("fogofwalk/telegram-token/v1")

async function key() {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    "HKDF",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptTelegramToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    encoder.encode(token)
  )
  return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`
}

export async function decryptTelegramToken(
  envelope: string
): Promise<string | null> {
  try {
    const [version, rawIv, rawCiphertext] = envelope.split(".")
    if (version !== "v1" || !rawIv || !rawCiphertext) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(rawIv, "base64") },
      await key(),
      Buffer.from(rawCiphertext, "base64")
    )
    return decoder.decode(plaintext)
  } catch {
    return null
  }
}

export async function sendTelegram(
  store: ServerStore,
  text: string
): Promise<"not_configured" | "sent" | "failed"> {
  const [chatId, savedToken] = await Promise.all([
    store.getSetting("telegram_chat_id"),
    store.getSetting("telegram_bot_token"),
  ])
  const token = savedToken ? await decryptTelegramToken(savedToken) : null
  if (!chatId || !token) return "not_configured"
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(5_000),
      }
    )
    if (!response.ok) return "failed"
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean
    } | null
    return body?.ok ? "sent" : "failed"
  } catch {
    return "failed"
  }
}
