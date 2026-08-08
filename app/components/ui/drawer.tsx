import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "~/lib/utils"

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * vaul renders a Radix `Dialog.Root` but never forwards its own `modal` prop to
 * it (vaul/dist/index.mjs — only defaultOpen/onOpenChange/open are passed), so
 * the drawer is *always* a trapped Radix `FocusScope`, even with modal={false}.
 *
 * Base UI popups (Select, …) portal to `<body>`, outside that scope. When one
 * focuses its content, FocusScope's document-level focusout handler yanks focus
 * straight back into the drawer — and Base UI's `SelectTrigger.onFocus` closes
 * the popup whenever `alignItemWithTrigger` is active, so the dropdown opens and
 * dismisses itself in the same frame.
 *
 * Swallowing focus events that belong to a Base UI portal before Radix's
 * document listeners see them fixes the class of bug rather than one instance.
 * Scoped to `[data-base-ui-portal]`, so it only affects Base UI popups opened
 * while a drawer is mounted.
 */
function useBaseUiPortalFocusGuard() {
  React.useEffect(() => {
    const isBaseUi = (node: EventTarget | null) =>
      node instanceof Element && node.closest("[data-base-ui-portal]") != null
    const stop = (e: FocusEvent) => {
      if (isBaseUi(e.target) || isBaseUi(e.relatedTarget)) {
        e.stopImmediatePropagation()
      }
    }
    document.addEventListener("focusin", stop, true)
    document.addEventListener("focusout", stop, true)
    return () => {
      document.removeEventListener("focusin", stop, true)
      document.removeEventListener("focusout", stop, true)
    }
  }, [])
}

function DrawerContent({
  className,
  children,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  useBaseUiPortalFocusGuard()
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "group/drawer-content fixed z-50 flex h-auto flex-col bg-popover text-xs/relaxed text-popover-foreground data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-none data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:rounded-none data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:rounded-none data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-none data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=left]:sm:max-w-sm data-[vaul-drawer-direction=right]:sm:max-w-sm",
          className
        )}
        onPointerDownOutside={(e) => {
          onPointerDownOutside?.(e)
          // Prevent Vaul from dismissing the drawer when the pointer-down
          // originated inside a Base UI dialog portal. The portal lives in
          // <body> as a sibling of the drawer, so Radix's DismissableLayer
          // incorrectly treats every dialog click as an "outside" press.
          const target = e.detail.originalEvent.target as Element | null
          if (target?.closest("[data-base-ui-portal]")) {
            e.preventDefault()
          }
        }}
        {...props}
      >
        <div className="mx-auto mt-2 hidden h-1 w-25 shrink-0 rounded-none bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-0.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        "font-heading text-sm font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
