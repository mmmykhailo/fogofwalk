import type { ParsedActivity } from "~/types/activities"
import type {
  UniqueDistanceRequest,
  UniqueDistanceResponse,
} from "~/workers/uniqueDistanceWorker"

let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<
  number,
  {
    resolve: (distances: Map<string, number>) => void
    reject: (error: Error) => void
  }
>()

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(
    new URL("../workers/uniqueDistanceWorker.ts", import.meta.url),
    { type: "module" }
  )
  worker.onmessage = ({ data }: MessageEvent<UniqueDistanceResponse>) => {
    const request = pending.get(data.requestId)
    if (!request) return
    pending.delete(data.requestId)
    request.resolve(new Map(data.distances))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || "Unique-distance worker failed")
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function computeUniqueDistancesInWorker(
  activities: ParsedActivity[]
): Promise<Map<string, number>> {
  if (activities.length === 0) return Promise.resolve(new Map())

  const requestId = ++nextRequestId
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    getWorker().postMessage({
      requestId,
      activities: activities.map(({ id, coordinates }) => ({
        id,
        coordinates,
      })),
    } satisfies UniqueDistanceRequest)
  })
}
