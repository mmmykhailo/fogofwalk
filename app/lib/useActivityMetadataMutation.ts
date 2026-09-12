import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import type { clientAction } from "~/routes/activities"
import {
  createActivitySettingsFormData,
  type ActivityMetadataActionResult,
} from "~/lib/activitySettings"
import type { ActivityType } from "~/types/activities"
import type { ActivitySummary } from "~/types/activitySummary"
import { createUuid } from "~/lib/uuid"

interface ActivityMetadataValue {
  isPublic: boolean
  activityType?: ActivityType
}

interface PendingMetadataMutation {
  operationId: string
  value: ActivityMetadataValue
}

export interface ActivityMetadataMutationResult extends ActivityMetadataValue {
  isPending: boolean
  error: string | null
  changeVisibility(nextIsPublic: boolean): void
  changeActivityType(nextActivityType: ActivityType | null): void
}

function valueFromActivity(activity: ActivitySummary): ActivityMetadataValue {
  return {
    isPublic: activity.isPublic ?? false,
    ...(activity.activityType ? { activityType: activity.activityType } : {}),
  }
}

function sameValue(
  first: ActivityMetadataValue,
  second: ActivityMetadataValue
): boolean {
  return (
    first.isPublic === second.isPublic &&
    first.activityType === second.activityType
  )
}

/**
 * Owns the optimistic state for one activity settings control. The route
 * action confirms the local summary transaction; sync happens separately.
 */
export function useActivityMetadataMutation(
  activity: ActivitySummary
): ActivityMetadataMutationResult {
  const fetcher = useFetcher<typeof clientAction>()
  const initialValue = valueFromActivity(activity)
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const valueRef = useRef(value)
  const confirmedRef = useRef(initialValue)
  const pendingRef = useRef<PendingMetadataMutation | null>(null)

  useEffect(() => {
    const pending = pendingRef.current
    if (pending) return
    const next = valueFromActivity(activity)
    confirmedRef.current = next
    valueRef.current = next
    setValue((previous) => (sameValue(previous, next) ? previous : next))
  }, [activity.activityType, activity.id, activity.isPublic])

  useEffect(() => {
    const result = fetcher.data as ActivityMetadataActionResult | undefined
    const pending = pendingRef.current
    if (!result || !pending || result.operationId !== pending.operationId) {
      return
    }

    if (result.ok) {
      const updated = result.updated.find((item) => item.id === activity.id)
      const next = updated ? valueFromActivity(updated) : pending.value
      confirmedRef.current = next
      valueRef.current = next
      pendingRef.current = null
      setIsPending(false)
      setError(null)
      setValue(next)
      return
    }

    const rollback = confirmedRef.current
    pendingRef.current = null
    valueRef.current = rollback
    setIsPending(false)
    setValue(rollback)
    setError(result.error)
  }, [activity.id, fetcher.data, fetcher.state])

  const submit = useCallback(
    (
      next: ActivityMetadataValue,
      update: Parameters<typeof createActivitySettingsFormData>[0]
    ) => {
      const operationId = createUuid()
      pendingRef.current = { operationId, value: next }
      valueRef.current = next
      setValue(next)
      setError(null)
      setIsPending(true)
      fetcher.submit(createActivitySettingsFormData(update, operationId), {
        method: "post",
        action: "/activities",
      })
    },
    [fetcher]
  )

  const changeVisibility = useCallback(
    (nextIsPublic: boolean) => {
      const current = valueRef.current
      if (current.isPublic === nextIsPublic) return
      submit(
        { ...current, isPublic: nextIsPublic },
        {
          activityIds: [activity.id],
          setting: "visibility",
          value: nextIsPublic,
        }
      )
    },
    [activity.id, submit]
  )

  const changeActivityType = useCallback(
    (nextActivityType: ActivityType | null) => {
      if (!nextActivityType) return
      const current = valueRef.current
      if (current.activityType === nextActivityType) return
      submit(
        { ...current, activityType: nextActivityType },
        {
          activityIds: [activity.id],
          setting: "activityType",
          value: nextActivityType,
        }
      )
    },
    [activity.id, submit]
  )

  return {
    ...value,
    isPending,
    error,
    changeVisibility,
    changeActivityType,
  }
}
