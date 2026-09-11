import { useCallback, useEffect, useRef } from "react"
import type maplibregl from "maplibre-gl"
import { activitiesFeatureCollection } from "~/lib/map/geojson"
import { applyFogDataToMap } from "~/lib/map/commands"
import { MAP_SOURCE_IDS } from "~/lib/map/layers"
import {
  fogCoordinator,
  mapStore,
  recordFogSnapshot,
  setFogProcessedCount,
} from "~/lib/mapStore"
import { saveFogCache } from "~/lib/storage"
import { recordDiagnostic } from "~/lib/diagnostics"
import {
  FOG_ALGORITHM_VERSION,
  FOG_PARTITION_SCHEME_VERSION,
  FOG_PROTOCOL_VERSION,
  type FogReply,
  type FogSnapshot,
} from "~/lib/fog/protocol"
import { validateFogRenderData } from "~/lib/fog/engine/validate"

type ProcessingComplete = () => void

function isCurrentSnapshot(snapshot: FogSnapshot): boolean {
  return (
    snapshot.generation === mapStore.runId &&
    snapshot.libraryRevision === mapStore.libraryRevision &&
    snapshot.mode === mapStore.fogMode &&
    snapshot.algorithmVersion === FOG_ALGORITHM_VERSION &&
    snapshot.partitionSchemeVersion === FOG_PARTITION_SCHEME_VERSION &&
    validateFogRenderData(snapshot.geometry).ok
  )
}

/** Bridges authoritative revisioned fog snapshots into the UI and map sources. */
export function useFogWorkerBridge(onProcessingComplete?: ProcessingComplete): {
  invalidateActivitiesCache: () => void
} {
  const onProcessingCompleteRef = useRef(onProcessingComplete)
  onProcessingCompleteRef.current = onProcessingComplete

  // Avoid rebuilding and re-uploading the same activity GeoJSON on every fog
  // update. The revision catches delete+add with equal activity counts.
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

    const setSnapshotOnMap = (snapshot: FogSnapshot) => {
      if (!isCurrentSnapshot(snapshot)) return false
      const operationId = `fog-${snapshot.generation}-${snapshot.libraryRevision}`
      recordDiagnostic({
        subsystem: "render",
        operationId,
        libraryRevision: snapshot.libraryRevision,
        stage: "snapshot",
        itemCount: mapStore.activities.length,
        pointCount: snapshot.diagnostics.outputPoints,
        result: snapshot.completeness === "complete" ? "success" : "degraded",
        geometry: {
          inputPoints: snapshot.diagnostics.inputPoints,
          outputPoints: snapshot.diagnostics.outputPoints,
          featureCount: snapshot.diagnostics.featureCount,
          vertexCount: snapshot.diagnostics.vertexCount,
        },
      })
      recordFogSnapshot(snapshot)
      mapStore.fogSnapshot = {
        generation: snapshot.generation,
        libraryRevision: snapshot.libraryRevision,
        mode: snapshot.mode,
        algorithmVersion: snapshot.algorithmVersion,
        partitionSchemeVersion: snapshot.partitionSchemeVersion,
      }
      mapStore.fogData = snapshot.geometry
      setFogProcessedCount(snapshot.diagnostics.processed)

      const map = mapStore.map
      if (!map || !mapStore.sourcesReady) return true
      applyFogDataToMap(map, snapshot.geometry, snapshot.libraryRevision)

      const activitiesKey =
        `${mapStore.libraryRevision}:` +
        mapStore.activities.map((activity) => activity.id).join("\0")
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
      return true
    }

    const handleMessage = (event: MessageEvent<FogReply>) => {
      const message = event.data
      if (!message || message.protocolVersion !== FOG_PROTOCOL_VERSION) return

      const result = fogCoordinator.handleReply(message)
      if (!result.accepted) return

      // Replies from an abandoned generation cannot mutate the map, progress,
      // cache, or completion state.
      if (message.generation !== mapStore.runId) return

      if (message.type === "ERROR") {
        console.warn(
          `[worker] fog ${message.fatal ? "failed" : "degraded"}: ${message.message}`
        )
        return
      }

      if (message.type === "PROGRESS") {
        setFogProcessedCount(message.processed)
        return
      }

      if (message.type === "UPDATE") {
        if (result.snapshot) setSnapshotOnMap(result.snapshot)
        return
      }

      if (message.type === "CANCELLED") {
        mapStore.isRestoreReprocess = false
        return
      }

      if (result.snapshot) setSnapshotOnMap(result.snapshot)
      if (!result.terminal || mapStore.isFogRunInFlight) return

      const snapshot = result.snapshot
      if (
        snapshot?.completeness === "complete" &&
        mapStore.activities.length > 0 &&
        mapStore.fogData &&
        isCurrentSnapshot(snapshot)
      ) {
        const cacheOperationId = `fog-cache-${snapshot.generation}-${snapshot.libraryRevision}`
        void saveFogCache({
          activityIds: mapStore.activities
            .map((activity) => activity.id)
            .sort(),
          libraryRevision: snapshot.libraryRevision,
          fogMode: snapshot.mode,
          algorithmVersion: snapshot.algorithmVersion,
          partitionSchemeVersion: snapshot.partitionSchemeVersion,
          fogData: snapshot.geometry,
        })
          .then(() => {
            recordDiagnostic({
              subsystem: "storage",
              operationId: cacheOperationId,
              libraryRevision: snapshot.libraryRevision,
              stage: "fog-cache-write",
              itemCount: mapStore.activities.length,
              pointCount: snapshot.diagnostics.outputPoints,
              result: "success",
              geometry: {
                featureCount: snapshot.diagnostics.featureCount,
                vertexCount: snapshot.diagnostics.vertexCount,
              },
            })
          })
          .catch(() => {
            recordDiagnostic({
              subsystem: "storage",
              operationId: cacheOperationId,
              libraryRevision: snapshot.libraryRevision,
              stage: "fog-cache-write",
              itemCount: mapStore.activities.length,
              pointCount: snapshot.diagnostics.outputPoints,
              result: "failed",
              errorCode: "fog-cache-write-failed",
              retryability: "retryable",
            })
          })
      }

      mapStore.isRestoreReprocess = false
      onProcessingCompleteRef.current?.()
    }

    mapStore.isFogWorkerListenerReady = true
    worker.onmessage = handleMessage
    const handleError = (event: ErrorEvent) => {
      console.warn("[worker] fog worker failed", event.error ?? event.message)
      fogCoordinator.handleWorkerFailure(event.error ?? event.message)
    }
    worker.onerror = handleError

    return () => {
      mapStore.isFogWorkerListenerReady = false
      if (worker.onmessage === handleMessage) worker.onmessage = null
      if (worker.onerror === handleError) worker.onerror = null
    }
  }, [])

  return { invalidateActivitiesCache }
}
