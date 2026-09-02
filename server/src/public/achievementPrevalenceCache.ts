import type { PublicAchievementPrevalence } from "~shared/api"

/**
 * Lazily caches the global prevalence snapshot for one long-lived store.
 * Mutations invalidate it; the next profile request rebuilds it once.
 */
export class PublicAchievementPrevalenceCache {
  private value: PublicAchievementPrevalence | null = null

  get(compute: () => PublicAchievementPrevalence): PublicAchievementPrevalence {
    if (this.value === null) this.value = compute()
    return this.value
  }

  invalidate(): void {
    this.value = null
  }
}
