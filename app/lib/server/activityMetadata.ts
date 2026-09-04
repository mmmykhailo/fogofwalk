import type {
  ActivityMeta,
  ActivityMetadataUpdate,
  ActivityMetadataUpdateRequest,
  ActivityMetadataUpdateResponse,
} from "~shared/api"
import { apiPatch } from "./apiClient"

/** Send mutable activity fields without transferring the activity blob. */
export async function updateActivityMetadata(
  updates: readonly ActivityMetadataUpdate[]
): Promise<ActivityMeta[]> {
  const response = await apiPatch<ActivityMetadataUpdateResponse>(
    "/api/activities/metadata",
    { updates: [...updates] } satisfies ActivityMetadataUpdateRequest
  )
  return response.activities
}
