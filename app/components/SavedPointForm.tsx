import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { VisibilitySelect } from "~/components/activity-stats/VisibilitySelect"
import { Input } from "~/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import {
  SAVED_POINT_COLORS,
  type SavedPoint,
  type SavedPointColor,
} from "~shared/saved-points"
import type { clientAction } from "~/routes/home"
import { createUuid } from "~/lib/uuid"

export function SavedPointForm({
  point,
  coordinate,
  onCancel,
  onSave,
  onDelete,
}: {
  point: SavedPoint | null
  coordinate: [number, number] | null
  onCancel: () => void
  onSave: (point: SavedPoint) => void
  onDelete?: (id: string) => void
}) {
  const fetcher = useFetcher<typeof clientAction>()
  const [id] = useState(() => point?.id ?? createUuid())
  const [color, setColor] = useState<SavedPointColor>(point?.color ?? "blue")
  const [isPublic, setIsPublic] = useState(point?.isPublic ?? false)
  const errors =
    fetcher.data?.intent === "save-saved-point"
      ? fetcher.data.errors
      : undefined
  const isSubmitting = fetcher.state !== "idle"

  useEffect(() => {
    if (fetcher.data?.intent === "save-saved-point" && fetcher.data.point) {
      onSave(fetcher.data.point)
    }
    if (fetcher.data?.intent === "delete-saved-point" && fetcher.data.id) {
      onDelete?.(fetcher.data.id)
    }
  }, [fetcher.data, onDelete, onSave])

  return (
    <fetcher.Form
      method="post"
      className="space-y-3"
      aria-describedby={errors?.form ? "saved-point-error" : undefined}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="color" value={color} />
      <input
        type="hidden"
        name="isPublic"
        value={isPublic ? "true" : "false"}
      />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Coordinates</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm">
            Longitude
            <Input
              name="lng"
              required
              inputMode="decimal"
              defaultValue={point?.lng ?? coordinate?.[0].toFixed(6) ?? ""}
              aria-invalid={Boolean(errors?.lng)}
              aria-describedby={
                errors?.lng ? "saved-point-coordinates-error" : undefined
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Latitude
            <Input
              name="lat"
              required
              inputMode="decimal"
              defaultValue={point?.lat ?? coordinate?.[1].toFixed(6) ?? ""}
              aria-invalid={Boolean(errors?.lat)}
              aria-describedby={
                errors?.lat ? "saved-point-coordinates-error" : undefined
              }
            />
          </label>
        </div>
        {(errors?.lng || errors?.lat) && (
          <p
            id="saved-point-coordinates-error"
            className="mt-1.5 text-sm text-destructive"
          >
            {errors.lng ?? errors.lat}
          </p>
        )}
      </fieldset>
      <label className="grid gap-1.5 text-sm">
        Name
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={point?.name ?? ""}
          aria-invalid={Boolean(errors?.name)}
          aria-describedby={errors?.name ? "saved-point-name-error" : undefined}
        />
      </label>
      {errors?.name && (
        <p
          id="saved-point-name-error"
          className="-mt-1.5 text-sm text-destructive"
        >
          {errors.name}
        </p>
      )}
      <label className="grid gap-1.5 text-sm">
        Description
        <Textarea
          name="description"
          maxLength={2000}
          defaultValue={point?.description ?? ""}
        />
      </label>
      <div className="grid gap-1.5">
        <label htmlFor="saved-point-color" className="text-sm">
          Colour
        </label>
        <Select
          value={color}
          onValueChange={(value) => setColor(value as SavedPointColor)}
          modal={false}
        >
          <SelectTrigger
            id="saved-point-color"
            aria-label="Saved point colour"
            className="w-full bg-white"
          >
            <SelectValue>
              {(key: keyof typeof SAVED_POINT_COLORS) => (
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: SAVED_POINT_COLORS[key] }}
                  />
                  {key[0].toUpperCase() + key.slice(1)}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {Object.entries(SAVED_POINT_COLORS).map(([key, value]) => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: value }}
                  />
                  {key[0].toUpperCase() + key.slice(1)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="saved-point-visibility" className="text-sm">
          Visibility
        </label>
        <VisibilitySelect
          isPublic={isPublic}
          onChange={setIsPublic}
          ariaLabel="Saved point visibility"
          className="w-full bg-white"
          size="default"
          id="saved-point-visibility"
        />
      </div>
      {errors?.form && (
        <p
          id="saved-point-error"
          className="text-sm text-destructive"
          aria-live="polite"
        >
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        {point && onDelete && (
          <Button
            type="submit"
            name="intent"
            value="delete-saved-point"
            variant="destructive"
            disabled={isSubmitting}
            onClick={(event) => {
              if (!window.confirm("Delete this saved point?"))
                event.preventDefault()
            }}
          >
            Delete saved point
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save-saved-point"
            disabled={isSubmitting}
          >
            {point ? "Save changes" : "Create"}
          </Button>
        </div>
      </div>
    </fetcher.Form>
  )
}
