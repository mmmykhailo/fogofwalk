import type { Decorator, Preview } from "@storybook/react-vite"
import { sb } from "storybook/test"

import "../app/app.css"
import { TooltipProvider } from "../app/components/ui/tooltip"
import { RouterDecorator } from "./decorators/RouterDecorator"

sb.mock(import("../app/lib/server/authStore.ts"), { spy: true })
sb.mock(import("../app/lib/server/apiClient.ts"), { spy: true })
sb.mock(import("../app/lib/server/config.ts"), { spy: true })
sb.mock(import("../app/lib/server/serverHealth.ts"), { spy: true })
sb.mock(import("../app/lib/server/sync/status.ts"), { spy: true })
sb.mock(import("../app/lib/server/uploadGate.ts"), { spy: true })
sb.mock(import("../app/lib/mapStore.ts"), { spy: true })
sb.mock(import("../app/lib/activities/import/status.ts"), { spy: true })
sb.mock(import("../app/lib/useCopyToClipboard.ts"), { spy: true })
sb.mock(import("../app/lib/shareCard.ts"), { spy: true })
sb.mock(import("../app/lib/storage.ts"), { spy: true })
sb.mock(import("../app/lib/diagnostics.ts"), { spy: true })

const themeDecorator: Decorator = (Story, context) => {
  const isDark = context.globals.theme === "dark"

  return (
    <div
      className={isDark ? "dark min-h-screen" : "min-h-screen"}
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
      data-storybook-theme={isDark ? "dark" : "light"}
    >
      <Story />
    </div>
  )
}

const tooltipDecorator: Decorator = (Story) => (
  <TooltipProvider>
    <Story />
  </TooltipProvider>
)

const preview = {
  decorators: [RouterDecorator, themeDecorator, tooltipDecorator],
  globalTypes: {
    theme: {
      description: "Application color theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    layout: "centered",
    a11y: {
      test: "error",
    },
    backgrounds: {
      default: "app",
      values: [{ name: "app", value: "var(--background)" }],
    },
    viewport: {
      options: {
        phone: {
          name: "Phone",
          styles: { width: "375px", height: "812px" },
        },
        tablet: {
          name: "Tablet",
          styles: { width: "768px", height: "1024px" },
        },
        desktop: {
          name: "Desktop",
          styles: { width: "1280px", height: "900px" },
        },
      },
    },
  },
  tags: ["autodocs"],
} satisfies Preview

export default preview
