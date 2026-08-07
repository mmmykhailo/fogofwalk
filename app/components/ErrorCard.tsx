import { WarningOctagonIcon } from "@phosphor-icons/react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "~/components/ui/card"
import { Button } from "~/components/ui/button"

interface ErrorCardProps {
  error: Error
  reset: () => void
  className?: string
}

/** Default presentation for a caught error. Also usable as a custom fallback. */
export function ErrorCard({ error, reset, className }: ErrorCardProps) {
  return (
    <div
      className={
        className === undefined
          ? "absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          : className
      }
    >
      <Card className="w-80 bg-background/80 backdrop-blur-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <WarningOctagonIcon
              weight="duotone"
              size={20}
              className="text-destructive"
            />
            <CardTitle>Something went wrong</CardTitle>
          </div>
          <CardDescription>
            {import.meta.env.DEV
              ? error.message
              : "An unexpected error occurred."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
