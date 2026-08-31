/// <reference lib="webworker" />

import {
  computePerActivityUniqueDistances,
  type UniqueDistanceActivity,
} from "~/lib/uniqueDistance"

export interface UniqueDistanceRequest {
  requestId: number
  activities: UniqueDistanceActivity[]
}

export interface UniqueDistanceResponse {
  requestId: number
  distances: [string, number][]
}

self.onmessage = ({ data }: MessageEvent<UniqueDistanceRequest>) => {
  const distances = computePerActivityUniqueDistances(data.activities)
  self.postMessage({
    requestId: data.requestId,
    distances: [...distances],
  } satisfies UniqueDistanceResponse)
}
