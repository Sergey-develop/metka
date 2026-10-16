import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { services } from '@/app/providers/services'
import { levelProgress } from '@/features/progression/levels'
import { ApiError, toApiError } from '@/services/api/errors'
import type { AvatarKey, Profile, ProfileStats } from '@/types/game'
import { useAuthStore } from './auth'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<Profile | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)

  const progress = computed(() => levelProgress(profile.value?.xp ?? 0))

  let inflight: Promise<void> | null = null

  /** Concurrent callers (App watcher, router guard) share one request. */
  function load(): Promise<void> {
    const userId = useAuthStore().userId
    if (!userId) return Promise.resolve()
    inflight ??= (async () => {
      loading.value = true
      error.value = null
      try {
        profile.value = await services().api.getProfile(userId)
      } catch (e) {
        error.value = toApiError(e)
      } finally {
        loading.value = false
        inflight = null
      }
    })()
    return inflight
  }

  /** Loads the profile once per session; later calls resolve immediately. */
  async function ensureLoaded(): Promise<Profile | null> {
    if (!profile.value || profile.value.id !== useAuthStore().userId) await load()
    return profile.value
  }

  /** Applies server-confirmed stats returned by scan/quest RPCs. */
  function applyStats(stats: ProfileStats | null): void {
    if (stats && profile.value) profile.value = { ...profile.value, ...stats }
  }

  async function rename(username: string): Promise<void> {
    const userId = useAuthStore().userId
    if (!userId) throw new ApiError('unauthorized')
    profile.value = await services().api.updateProfile(userId, { username })
  }

  async function completeSetup(username: string, avatarKey: AvatarKey): Promise<void> {
    const userId = useAuthStore().userId
    if (!userId) throw new ApiError('unauthorized')
    const api = services().api
    await api.completeProfileSetup(username, avatarKey)
    profile.value = await api.getProfile(userId)
  }

  function reset(): void {
    profile.value = null
    error.value = null
  }

  return { profile, loading, error, progress, load, ensureLoaded, applyStats, rename, completeSetup, reset }
})
