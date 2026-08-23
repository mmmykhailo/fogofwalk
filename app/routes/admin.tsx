import { useLoaderData } from "react-router"
import type { AdminBootstrapResponse } from "~shared/api"
import { AdminPage } from "~/components/admin/AdminPage"
import { apiGet } from "~/lib/server/apiClient"
import { getAuthState, initAuth } from "~/lib/server/authStore"
import { isServerEnabled } from "~/lib/server/config"

export async function clientLoader(): Promise<AdminBootstrapResponse> {
  if (!isServerEnabled) throw new Response("Not found", { status: 404 })
  await initAuth()
  if (getAuthState().status !== "signedIn") throw new Response("Not found", { status: 404 })
  try { return await apiGet<AdminBootstrapResponse>("/api/admin/bootstrap") }
  catch { throw new Response("Not found", { status: 404 }) }
}

export default function AdminRoute() { return <AdminPage initial={useLoaderData<typeof clientLoader>()} /> }
