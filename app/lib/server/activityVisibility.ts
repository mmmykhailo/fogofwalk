import type {
  ActivityVisibilityUpdateRequest,
  ActivityVisibilityUpdateResponse,
} from "~shared/api"
import { apiPatch } from "./apiClient"

export async function updateActivityVisibility(
  contentHash: string,
  isPublic: boolean
): Promise<ActivityVisibilityUpdateResponse> {
  return apiPatch<ActivityVisibilityUpdateResponse>(
    `/api/activities/${contentHash}/visibility`,
    { isPublic } satisfies ActivityVisibilityUpdateRequest
  )
}
