import { defineStore } from 'pinia'
import { ref } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { QuestView } from '@/types/game'
import { useAchievementAlertsStore } from './achievementAlerts'
import { useProfileStore } from './profile'

/** an achievement completed within this long counts as «just now» */
const RECENT_MS = 10 * 60_000

export const useQuestsStore = defineStore('quests', () => {
  const quests = ref<QuestView[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const claiming = ref<Set<string>>(new Set())

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    error.value = null
    try {
      quests.value = await services().api.getQuests()
      loaded.value = true
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  async function claim(questId: string): Promise<void> {
    if (claiming.value.has(questId)) return // double tap guard; server is idempotent anyway
    claiming.value = new Set(claiming.value).add(questId)
    try {
      const result = await services().api.claimQuest(questId)
      useProfileStore().applyStats(result.profile)
      quests.value = quests.value.map((q) =>
        q.id === questId ? { ...q, claimedAt: q.claimedAt ?? new Date().toISOString() } : q,
      )
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      const next = new Set(claiming.value)
      next.delete(questId)
      claiming.value = next
    }
  }

  /**
   * After a quest step or a check-in (they report no achievements): fetch them again and announce the ones
   * completed a moment ago and not claimed yet (migration 033 completes them by trigger).
   */
  async function announceCompleted(): Promise<void> {
    await load(true)
    const since = Date.now() - RECENT_MS
    useAchievementAlertsStore().push(
      quests.value
        .filter((q) => q.completedAt && !q.claimedAt && Date.parse(q.completedAt) >= since)
        .map((q) => ({ questId: q.id, title: q.title })),
    )
  }

  function invalidate(): void {
    loaded.value = false
  }

  function reset(): void {
    quests.value = []
    loaded.value = false
    error.value = null
  }

  return { quests, loaded, loading, error, claiming, load, claim, announceCompleted, invalidate, reset }
})
