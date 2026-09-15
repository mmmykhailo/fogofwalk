import {
  CheckCircleIcon,
  DotsThreeIcon,
  MapPinIcon,
} from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "./item"
import { Button } from "./button"

const meta = {
  title: "UI/Item",
  component: Item,
  parameters: {
    layout: "padded",
    router: { withTransition: false },
  },
} satisfies Meta<typeof Item>

export default meta
type Story = StoryObj<typeof meta>

const variants = ["default", "outline", "muted"] as const
const sizes = ["default", "sm", "xs"] as const

export const VariantsAndSizes: Story = {
  render: () => (
    <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
      {variants.map((variant) => (
        <Item key={variant} variant={variant}>
          <ItemMedia variant="icon">
            <MapPinIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{variant} item</ItemTitle>
            <ItemDescription>7.4 km around the river.</ItemDescription>
          </ItemContent>
        </Item>
      ))}
      {sizes.map((size) => (
        <Item key={size} size={size} variant="outline">
          <ItemContent>
            <ItemTitle>{size} density</ItemTitle>
            <ItemDescription>Compact activity metadata.</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </div>
  ),
}

export const MediaHeaderFooterAndActions: Story = {
  render: () => (
    <ItemGroup
      role="group"
      aria-label="Imported activities and saved points"
      className="w-full max-w-xl"
    >
      <Item variant="outline">
        <ItemHeader>
          <span className="text-muted-foreground">Imported activity</span>
          <span>15 Sep 2026</span>
        </ItemHeader>
        <ItemMedia variant="image">
          <img src="/icons/icon-192.png" alt="" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            Riverside loop
            <CheckCircleIcon className="text-primary" />
          </ItemTitle>
          <ItemDescription>
            The long description wraps while the supporting action stays aligned
            with the content.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button size="icon-sm" variant="ghost" aria-label="More options">
            <DotsThreeIcon />
          </Button>
        </ItemActions>
        <ItemFooter>
          <span className="text-muted-foreground">Walking · 7.4 km</span>
          <Button size="xs">Open</Button>
        </ItemFooter>
      </Item>
      <ItemSeparator />
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Another saved point</ItemTitle>
          <ItemDescription>No photo attached.</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
}

export const ButtonAndLinkRendering: Story = {
  render: () => (
    <div className="grid w-full max-w-md gap-2">
      <Item variant="outline" render={<button type="button" />}>
        <ItemContent>
          <ItemTitle>Open local activity</ItemTitle>
          <ItemDescription>Rendered as a button item.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline" render={<a href="/stats" />}>
        <ItemContent>
          <ItemTitle>View statistics</ItemTitle>
          <ItemDescription>Rendered as an internal-style link.</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  ),
}

const onItemClick = fn()
const onActionClick = fn()

export const InteractiveWithIndependentAction: Story = {
  render: () => (
    <Item variant="outline" className="w-full max-w-md">
      <ItemContent>
        <ItemTitle>Choose this activity</ItemTitle>
        <ItemDescription>
          The trailing action can be operated independently.
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" onClick={onItemClick}>
          Select
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Activity options"
          onClick={onActionClick}
        >
          <DotsThreeIcon />
        </Button>
      </ItemActions>
    </Item>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Select" })
    )
    await userEvent.click(
      await canvas.findByRole("button", { name: "Activity options" })
    )
    await expect(onItemClick).toHaveBeenCalledTimes(1)
    await expect(onActionClick).toHaveBeenCalledTimes(1)
  },
}
