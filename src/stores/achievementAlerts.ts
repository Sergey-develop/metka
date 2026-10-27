import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface UnlockedAchievement {
  questId: string
  title: string
}

/**
 * Achievements just completed, waiting to be shown (AchievementUnlocked) — one at a time, in the order they
 * came. The server reports them with the scan that completed them (submit_building_scan: completedQuests).
 */
export const useAchievementAlertsStore = defineStore('achievementAlerts', () => {
  const queue = ref<UnlockedAchievement[]>([])
  const current = computed(() => queue.value[0] ?? null)

  function push(list: readonly UnlockedAchievement[]): void {
    const known = new Set(queue.value.map((a) => a.questId))
    queue.value = [...queue.value, ...list.filter((a) => !known.has(a.questId))]
  }
  function dismiss(): void {
    queue.value = queue.value.slice(1)
  }
  function reset(): void {
    queue.value = []
  }

  return { queue, current, push, dismiss, reset }
})
