import type { AccessRequest } from "~shared/api"
import { apiGet, apiPost, friendlyMessage } from "~/lib/server/apiClient"
import { refreshAuth } from "~/lib/server/authStore"

export interface AccessRequestData {
  error: string | null
  request: AccessRequest | null
}

export async function clientLoader(): Promise<AccessRequestData> {
  try {
    const request = await apiGet<AccessRequest | null>("/api/access-request")
    await refreshAuth()
    return { request, error: null }
  } catch (err) {
    return { request: null, error: friendlyMessage(err) }
  }
}

export async function clientAction(): Promise<AccessRequestData> {
  try {
    return {
      request: await apiPost<AccessRequest>("/api/access-request"),
      error: null,
    }
  } catch (err) {
    return { request: null, error: friendlyMessage(err) }
  }
}
