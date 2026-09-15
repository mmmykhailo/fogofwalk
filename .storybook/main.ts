import type { StorybookConfig } from "@storybook/react-vite"

const config = {
  stories: ["../app/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: ".storybook/vite.config.ts",
      },
    },
  },
  staticDirs: ["../public"],
  docs: {
    autodocs: "tag",
  },
} satisfies StorybookConfig

export default config
