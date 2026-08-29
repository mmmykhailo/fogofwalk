import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import {
  SAVED_POINT_COLORS,
  type SavedPoint,
  type SavedPointColor,
} from "~shared/saved-points"

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
  onSave: (input: Omit<SavedPoint, "createdAt" | "updatedAt">) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(point?.name ?? "")
  const [description, setDescription] = useState(point?.description ?? "")
  const [lng, setLng] = useState(
    String(point?.lng ?? coordinate?.[0].toFixed(6) ?? "")
  )
  const [lat, setLat] = useState(
    String(point?.lat ?? coordinate?.[1].toFixed(6) ?? "")
  )
  const [color, setColor] = useState<SavedPointColor>(point?.color ?? "blue")
  const [isPublic, setIsPublic] = useState(point?.isPublic ?? false)
  const [error, setError] = useState("")
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsedLng = Number(lng),
      parsedLat = Number(lat)
    if (
      !name.trim() ||
      !Number.isFinite(parsedLng) ||
      !Number.isFinite(parsedLat) ||
      parsedLng < -180 ||
      parsedLng > 180 ||
      parsedLat < -90 ||
      parsedLat > 90
    ) {
      setError("Enter a name and valid WGS84 coordinates.")
      return
    }
    onSave({
      id: point?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || null,
      lng: parsedLng,
      lat: parsedLat,
      color,
      isPublic,
    })
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3"
      aria-describedby={error ? "saved-point-error" : undefined}
    >
      <fieldset>
        <legend>Coordinates</legend>
        <label>
          Longitude
          <Input
            required
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </label>
        <label>
          Latitude
          <Input
            required
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </label>
      </fieldset>
      <label>
        Name
        <Input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Description
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>Colour</legend>
        {Object.keys(SAVED_POINT_COLORS).map((key) => (
          <label key={key}>
            <input
              type="radio"
              name="colour"
              checked={color === key}
              onChange={() => setColor(key as SavedPointColor)}
            />
            {key}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Visibility</legend>
        <label>
          <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          Public
        </label>
      </fieldset>
      {error && (
        <p id="saved-point-error" aria-live="polite">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit">{point ? "Save changes" : "Create"}</Button>
      {point && onDelete && (
        <Button type="button" variant="destructive" onClick={onDelete}>
          Delete saved point
        </Button>
      )}
    </form>
  )
}
