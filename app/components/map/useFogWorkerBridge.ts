import { useCallback, useEffect, useRef } from "react"
import type maplibregl from "maplibre-gl"
import { activitiesFeatureCollection } from "~/lib/map/geojson"
import { MAP_SOURCE_IDS } from "~/lib/map/layers"
import { finishFogJob, mapStore } from "~/lib/mapStore"
import { saveFogCache } from "~/lib/storage"
import type { WorkerOutboundMessage } from "~/types/activities"

type ProcessingUpdate = (count: number, done: boolean) => void

/** Bridges authoritative fog-worker state into the UI and live map sources. */
export function useFogWorkerBridge(onProcessingUpdate?: ProcessingUpdate): {
  invalidateActivitiesCache: () => void
} {
  const onProcessingUpdateRef = useRef(onProcessingUpdate)
  onProcessingUpdateRef.current = onProcessingUpdate

  // Avoid rebuilding and re-uploading the same activity GeoJSON on every
  // 300 ms FOG_UPDATE. The id key also catches delete+add with equal counts.
  const cachedActivitiesGeoJSON = useRef<ReturnType<
    typeof activitiesFeatureCollection
  > | null>(null)
  const cachedActivitiesKey = useRef<string | null>(null)

  const invalidateActivitiesCache = useCallback(() => {
    cachedActivitiesGeoJSON.current = null
    cachedActivitiesKey.current = null
  }, [])

  useEffect(() => {
    const worker = mapStore.worker
    if (!worker) return

    const handleMessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const message = event.data
      const map = mapStore.map

      // Already-queued replies from an abandoned run must not mutate state.
      if (message.runId !== mapStore.runId) return

      if (message.type === "ERROR") {
        mapStore.fogWorkerActivityIds.clear()
        console.warn(
          `[worker] fog failed for ${message.file}: ${message.message}`
        )
        return
      }

      if (message.type === "PROGRESS") {
        mapStore.processedCount = message.processedCount
        onProcessingUpdateRef.current?.(message.processedCount, false)
        return
      }

      if (message.type === "DONE") {
        mapStore.processedCount = message.processedCount
        const isRunDone = finishFogJob()
        onProcessingUpdateRef.current?.(message.processedCount, isRunDone)

        if (isRunDone && mapStore.activities.length > 0 && mapStore.fogData) {
          saveFogCache({
            activityIds: mapStore.activities
              .map((activity) => activity.id)
              .sort(),
            fogMode: mapStore.fogMode,
            fogData: mapStore.fogData,
          })
        }

        // The callback above reads this flag when deciding whether to fit bounds.
        mapStore.isRestoreReprocess = false
        return
      }

      // FOG_UPDATE state remains authoritative while setStyle has no sources.
      mapStore.fogData = message.fogData
      mapStore.processedCount = message.processedCount
      onProcessingUpdateRef.current?.(message.processedCount, false)

      if (!map || !mapStore.sourcesReady) return

      const fogSource = map.getSource(MAP_SOURCE_IDS.fog) as
        | maplibregl.GeoJSONSource
        | undefined
      fogSource?.setData(message.fogData)

      const activitiesKey = mapStore.activities
        .map((activity) => activity.id)
        .join("\0")
      if (
        activitiesKey !== cachedActivitiesKey.current ||
        !cachedActivitiesGeoJSON.current
      ) {
        cachedActivitiesGeoJSON.current = activitiesFeatureCollection(
          mapStore.activities
        )
        cachedActivitiesKey.current = activitiesKey
        const activitiesSource = map.getSource(MAP_SOURCE_IDS.activities) as
          | maplibregl.GeoJSONSource
          | undefined
        activitiesSource?.setData(cachedActivitiesGeoJSON.current)
      }
    }

    mapStore.isFogWorkerListenerReady = true
    worker.onmessage = handleMessage

    return () => {
      mapStore.isFogWorkerListenerReady = false
      if (worker.onmessage === handleMessage) worker.onmessage = null
    }
  }, [])

  return { invalidateActivitiesCache }
}
