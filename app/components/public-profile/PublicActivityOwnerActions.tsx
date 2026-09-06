import { Menu } from "@base-ui/react/menu"
import { DotsThreeIcon } from "@phosphor-icons/react"
import { useFetcher } from "react-router"
import type { clientAction } from "~/routes/u.$handle"

interface PublicActivityOwnerActionsProps {
  activityName: string
  contentHash: string
}

export function PublicActivityOwnerActions({
  activityName,
  contentHash,
}: PublicActivityOwnerActionsProps) {
  const fetcher = useFetcher<typeof clientAction>()
  const submittedHash = fetcher.formData?.get("contentHash")
  const isHiding = fetcher.state !== "idle" && submittedHash === contentHash
  const error =
    fetcher.data?.intent === "hide-activity" && !fetcher.data.ok
      ? fetcher.data.error
      : null
  const lastDot = activityName.lastIndexOf(".")
  const label = lastDot > 0 ? activityName.slice(0, lastDot) : activityName

  function hideFromProfile() {
    const formData = new FormData()
    formData.set("intent", "hide-activity")
    formData.set("contentHash", contentHash)
    fetcher.submit(formData, { method: "post" })
  }

  return (
    <div className="contents">
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Activity actions for ${label}`}
          className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={isHiding}
        >
          <DotsThreeIcon size={18} weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4}>
            <Menu.Popup className="z-50 min-w-40 border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
              <Menu.Item
                className="flex w-full cursor-pointer items-center px-2 py-1.5 text-sm outline-none hover:bg-muted data-[highlighted]:bg-muted"
                disabled={isHiding}
                onClick={hideFromProfile}
              >
                Hide from profile
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
