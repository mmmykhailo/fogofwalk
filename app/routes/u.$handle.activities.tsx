import { useEffect, useRef } from "react"
import { useLoaderData, useLocation, useNavigate } from "react-router"
import { FootprintsIcon, InfoIcon } from "@phosphor-icons/react"
import { PageShell } from "~/components/PageShell"
import { PublicActivitiesSection } from "~/components/public-profile/PublicActivitiesSection"
import { PublicProfileHeader } from "~/components/public-profile/PublicProfileHeader"
import { TransitionLink } from "~/components/TransitionLink"
import { buttonVariants } from "~/components/ui/button"
import { getTotalPages } from "~/lib/pagination"
import {
  handlePublicActivityAction,
  type PublicActivityActionResult,
} from "~/lib/publicActivityActions"
import { getCanonicalPublicActivitiesPage } from "~/lib/publicActivitiesRoute"
import { apiUrl } from "~/lib/server/config"
import { initAuth, useAuth } from "~/lib/server/authStore"
import { socialMeta } from "~/lib/socialMeta"
import { cn } from "~/lib/utils"
import type { PublicActivitiesPage, PublicProfileResponse } from "~shared/api"
import { PUBLIC_ACTIVITY_PAGE_SIZE } from "~shared/constants"
import type { Route } from "./+types/u.$handle.activities"

interface PublicActivitiesLoaderData {
  profile: PublicProfileResponse | null
  activityPage: PublicActivitiesPage | null
  page: number
  canonicalSearch: string
  error: string | null
}

async function readJsonError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}))
  return body.message || "Profile not found."
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<PublicActivitiesLoaderData> {
  const handle = params.handle
  if (!handle) {
    return {
      profile: null,
      activityPage: null,
      page: 1,
      canonicalSearch: "",
      error: "Profile not found.",
    }
  }

  // Public data remains anonymous. Auth is restored only to identify the
  // owner and reveal the local management link/actions.
  void initAuth()

  try {
    const searchParams = new URL(request.url).searchParams
    const requested = getCanonicalPublicActivitiesPage(searchParams)
    const encodedHandle = encodeURIComponent(handle)
    const [profileRes, activitiesRes] = await Promise.all([
      fetch(apiUrl(`/api/public/users/${encodedHandle}`), {
        signal: request.signal,
      }),
      fetch(
        apiUrl(
          `/api/public/users/${encodedHandle}/activities?page=${requested.page}`
        ),
        { signal: request.signal }
      ),
    ])
    if (!profileRes.ok || !activitiesRes.ok) {
      throw new Error(
        await readJsonError(profileRes.ok ? activitiesRes : profileRes)
      )
    }

    const profile = (await profileRes.json()) as PublicProfileResponse
    let activityPage = (await activitiesRes.json()) as PublicActivitiesPage
    const canonical = getCanonicalPublicActivitiesPage(
      searchParams,
      activityPage.totalCount
    )

    // The public API reports the total count with every page. If a page was
    // made invalid by a hide/delete, fetch the clamped page before rendering
    // so the URL and the visible cards agree.
    if (canonical.page !== requested.page) {
      const correctedRes = await fetch(
        apiUrl(
          `/api/public/users/${encodedHandle}/activities?page=${canonical.page}`
        ),
        { signal: request.signal }
      )
      if (!correctedRes.ok) throw new Error(await readJsonError(correctedRes))
      activityPage = (await correctedRes.json()) as PublicActivitiesPage
    }

    return {
      profile,
      activityPage,
      page: canonical.page,
      canonicalSearch: canonical.searchParams.toString(),
      error: null,
    }
  } catch (err) {
    return {
      profile: null,
      activityPage: null,
      page: 1,
      canonicalSearch: "",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function clientAction({
  params,
  request,
}: Route.ClientActionArgs): Promise<PublicActivityActionResult> {
  return handlePublicActivityAction({
    profileHandle: params.handle,
    request,
  })
}

export function meta({ data, params }: Route.MetaArgs) {
  const handle = data?.profile?.user.handle || params.handle || "Profile"
  const displayName = data?.profile?.user.displayName || handle
  return socialMeta({
    title: `${displayName}'s activities — Fog of Walk`,
    description: `Public activities by ${displayName} on Fog of Walk.`,
    path: `/u/${encodeURIComponent(handle)}/activities`,
    type: "profile",
    profileHandle: handle,
  })
}

export default function PublicActivitiesPage() {
  const { profile, activityPage, page, canonicalSearch, error } =
    useLoaderData<typeof clientLoader>()
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousPageRef = useRef(page)
  const activities = activityPage?.activities ?? []
  const activityCount = activityPage?.totalCount ?? 0
  const totalPages = getTotalPages(activityCount, PUBLIC_ACTIVITY_PAGE_SIZE)
  const isOwner =
    auth.status === "signedIn" &&
    auth.user.handle?.toLowerCase() === profile?.user.handle.toLowerCase()
  const profilePath = profile
    ? `/u/${encodeURIComponent(profile.user.handle)}`
    : "/map"

  useEffect(() => {
    const currentSearch = location.search.slice(1)
    if (canonicalSearch !== currentSearch) {
      navigate(
        {
          pathname: location.pathname,
          search: canonicalSearch ? `?${canonicalSearch}` : "",
        },
        { replace: true }
      )
    }
  }, [canonicalSearch, location.pathname, location.search, navigate])

  useEffect(() => {
    if (previousPageRef.current !== page) {
      headingRef.current?.focus()
    }
    previousPageRef.current = page
  }, [page])

  function navigateToPage(nextPage: number) {
    const next = new URLSearchParams(location.search)
    if (nextPage <= 1) next.delete("page")
    else next.set("page", String(nextPage))
    navigate({
      pathname: location.pathname,
      search: next.size > 0 ? `?${next}` : "",
    })
  }

  return (
    <PageShell
      backTo={profilePath}
      backLabel={profile ? "Back to profile" : "Back to map"}
    >
      {profile && (
        <PublicProfileHeader
          user={profile.user}
          title={`${profile.user.displayName}'s activities`}
          profilePath={profilePath}
        />
      )}

      {isOwner && profile && (
        <section
          aria-label="Activity management"
          className="mb-6 overflow-hidden border border-primary/20 bg-primary/[0.035]"
        >
          <div className="flex gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Manage your activities</p>
              <p className="mt-1 text-xs/relaxed text-muted-foreground">
                This page only shows your public activities. You can manage all
                your activities on the{" "}
                <TransitionLink
                  to="/activities"
                  className="font-medium underline underline-offset-3 hover:text-foreground"
                >
                  My activities
                </TransitionLink>{" "}
                page.
              </p>
            </div>
            <TransitionLink
              to="/activities"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "mt-3"
              )}
            >
              Manage activities
            </TransitionLink>
          </div>
        </section>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <TransitionLink
            to="/map"
            className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
          >
            Go to map →
          </TransitionLink>
        </div>
      )}

      {!error && profile && activityCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-none border border-dashed border-border py-24 text-center">
          <FootprintsIcon
            size={40}
            className="text-muted-foreground"
            weight="duotone"
          />
          <p className="text-sm text-muted-foreground">
            This user has no public activities yet
          </p>
        </div>
      )}

      {!error && profile && activityCount > 0 && (
        <PublicActivitiesSection
          activities={activities}
          isOwner={isOwner}
          headingRef={headingRef}
          pagination={{
            itemCount: activityCount,
            pageSize: PUBLIC_ACTIVITY_PAGE_SIZE,
            currentPage: page,
            totalPages,
            onPageChange: navigateToPage,
          }}
        />
      )}
    </PageShell>
  )
}
