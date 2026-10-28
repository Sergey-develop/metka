import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { TasksState } from '@/types/game'
import { useProfileStore } from './profile'
import { useQuestsStore } from './quests'
import { MOSCOW_ENABLED } from '@/utils/gameAreas'

/** Tasks of the day / week and the seasonal task (my_tasks, migration 020) for the map's tasks sheet. */
export const useTasksStore = defineStore('tasks', () => {
  const state = ref<TasksState | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const claiming = ref<Set<string>>(new Set())

  // «Исследуй 3 разных округа» are Moscow's okrugs: not shown with Moscow off (it could not be done)
  const shown = computed(() => (state.value?.tasks ?? []).filter((t) => MOSCOW_ENABLED || t.kind !== 'districts'))
  const day = computed(() => shown.value.filter((t) => t.period === 'day'))
  const week = computed(() => shown.value.filter((t) => t.period === 'week'))
  /** rewards waiting to be claimed — the badge on the map button */
  const ready = computed(() => {
    const s = state.value
    if (!s) return 0
    const tasks = s.tasks.filter((t) => t.progress >= t.target && !t.claimed).length
    return tasks + (s.season?.completed && !s.season.claimed ? 1 : 0)
  })

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      state.value = await services().api.getTasks()
    } catch (e) {
      // keep what was shown before
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  async function claim(slug: string): Promise<void> {
    if (claiming.value.has(slug)) return // double tap guard; the server is idempotent anyway
    claiming.value = new Set(claiming.value).add(slug)
    error.value = null
    try {
      const coins = await services().api.claimTask(slug)
      const profile = useProfileStore()
      if (profile.profile) profile.profile = { ...profile.profile, coins }
      if (state.value) state.value = { ...state.value, tasks: state.value.tasks.map((t) => (t.slug === slug ? { ...t, claimed: true } : t)) }
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      const next = new Set(claiming.value)
      next.delete(slug)
      claiming.value = next
    }
  }

  /** the seasonal task is a server quest: its reward goes through claim_quest_reward */
  async function claimSeason(): Promise<void> {
    const season = state.value?.season
    if (!season) return
    const quests = useQuestsStore()
    await quests.claim(season.id)
    if (quests.error) {
      error.value = quests.error
      return
    }
    if (state.value?.season) state.value = { ...state.value, season: { ...state.value.season, claimed: true } }
  }

  function reset(): void {
    state.value = null
    error.value = null
  }

  return { state, loading, error, claiming, day, week, ready, load, claim, claimSeason, reset }
})
