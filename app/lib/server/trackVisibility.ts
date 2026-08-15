import type {
  TrackVisibilityUpdateRequest,
  TrackVisibilityUpdateResponse,
} from "~shared/api"
import { apiPatch } from "./apiClient"

export async function updateTrackVisibility(
  contentHash: string,
  isPublic: boolean
): Promise<TrackVisibilityUpdateResponse> {
  return apiPatch<TrackVisibilityUpdateResponse>(
    `/api/tracks/${contentHash}/visibility`,
    { isPublic } satisfies TrackVisibilityUpdateRequest
  )
}
