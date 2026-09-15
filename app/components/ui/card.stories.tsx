import { ArrowRightIcon, MapPinIcon } from "@phosphor-icons/react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "./button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card"

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const CompleteComposition: Story = {
  render: () => (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Morning loop</CardTitle>
        <CardDescription>Imported 15 September 2026</CardDescription>
        <CardAction>
          <Button size="icon-sm" variant="ghost" aria-label="Open activity">
            <ArrowRightIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-muted-foreground">
          <MapPinIcon />
          <span>7.42 km · 48 minutes</span>
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <span className="text-muted-foreground">Walking</span>
        <Button size="sm">Share</Button>
      </CardFooter>
    </Card>
  ),
}

export const Sparse: Story = {
  render: () => (
    <Card size="sm" className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Saved point</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Coordinates are available, but this point has no description yet.
      </CardContent>
    </Card>
  ),
}

export const LongContent: Story = {
  render: () => (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Why this trail matters</CardTitle>
        <CardDescription>
          A card with enough copy to show wrapping in narrow layouts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        This route crosses the river, climbs through the old forest, and loops
        back along the ridge. The description is intentionally long so the
        composition remains legible when the viewport becomes compact.
      </CardContent>
    </Card>
  ),
}
