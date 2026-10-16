import { defineStore } from 'pinia'
import { ref } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, type ApiErrorCode, toApiError } from '@/services/api/errors'
import type { ClanMembership, ClanRanking } from '@/types/game'
import { type AvatarImageError, AvatarImageFailure, prepareAvatarImage } from '@/utils/avatarImage'
import { useAuthStore } from './auth'

export const useClanStore = defineStore('clan', () => {
  const membership = ref<ClanMembership | null>(null)
  const ranking = ref<ClanRanking[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<ApiError | null>(null)
  /** last load failed: the UI must not mistake this for "not in a clan" */
  const loadError = ref<ApiError | null>(null)
  const avatarBusy = ref(false)
  const avatarError = ref<AvatarImageError | ApiErrorCode | null>(null)

  async function load(): Promise<void> {
    const userId = useAuthStore().userId
    if (!userId) return
    loading.value = true
    loadError.value = null
    try {
      const api = services().api
      const [mine, top] = await Promise.all([api.getMyClan(userId), api.getClanLeaderboard()])
      membership.value = mine
      ranking.value = top
    } catch (e) {
      // keep whatever was shown before; a failed refresh is not "no clan"
      loadError.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      await action()
      await load()
      return true
    } catch (e) {
      error.value = toApiError(e)
      return false
    } finally {
      busy.value = false
    }
  }

  const create = (name: string, tag: string) => run(() => services().api.createClan(name, tag))
  const join = (clanId: string) => run(() => services().api.joinClan(clanId))
  const leave = () => run(() => services().api.leaveClan())

  /** Owner only: re-encodes the picked picture and uploads it as the clan avatar. */
  async function setAvatar(file: Blob): Promise<boolean> {
    return changeAvatar(async (clanId) => services().api.setClanAvatar(clanId, await prepareAvatarImage(file)))
  }

  const removeAvatar = () => changeAvatar(() => services().api.removeClanAvatar())

  async function changeAvatar(action: (clanId: string) => Promise<void>): Promise<boolean> {
    const clanId = membership.value?.clan.id
    if (!clanId || avatarBusy.value) return false
    avatarBusy.value = true
    avatarError.value = null
    try {
      await action(clanId)
      await load()
      return true
    } catch (e) {
      avatarError.value = e instanceof AvatarImageFailure ? e.code : toApiError(e).code
      return false
    } finally {
      avatarBusy.value = false
    }
  }

  function reset(): void {
    membership.value = null
    ranking.value = []
    error.value = null
    loadError.value = null
    avatarError.value = null
  }

  return {
    membership,
    ranking,
    loading,
    busy,
    error,
    loadError,
    avatarBusy,
    avatarError,
    load,
    create,
    join,
    leave,
    setAvatar,
    removeAvatar,
    reset,
  }
})
