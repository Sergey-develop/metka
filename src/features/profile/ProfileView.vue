<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import PageOverlay from '@/components/ui/PageOverlay.vue'
import CountUp from '@/components/ui/CountUp.vue'
import LevelProgress from '@/components/ui/LevelProgress.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import WalletStreak from '@/components/ui/WalletStreak.vue'
import { gameAreaAt, HOME_AREA, MOSCOW_ENABLED, type GameAreaId } from '@/utils/gameAreas'
import { daysText } from '@/utils/plural'
import { scrollToTopAfterLock } from '@/utils/scrollLock'
import { type ApiErrorCode, toApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useClanStore } from '@/stores/clan'
import { useCollectionStore } from '@/stores/collection'
import { useMapStore } from '@/stores/map'
import { useMemoriesStore } from '@/stores/memories'
import { useProfileStore } from '@/stores/profile'
import { useQuestsStore } from '@/stores/quests'
import type { PlayerProgress, PlayerStats, PublicProfile, QuestView, Rarity } from '@/types/game'
import DiarySheet from '@/features/album/DiarySheet.vue'
import ClanSheet from '@/features/map/ClanSheet.vue'
import ClanAvatar from '@/features/clans/ClanAvatar.vue'
import AchievementBadge from './AchievementBadge.vue'
import AchievementSheet from './AchievementSheet.vue'
import { badgeKind, sortAchievements } from './achievements'
import MoscowMapCard from './MoscowMapCard.vue'
import ProfileSettingsSheet from './ProfileSettingsSheet.vue'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import { collectionPhoto } from '@/features/routes/photos'

/**
 * The player's own profile, or — with `userId` of someone else (opened from the clan screen) — that
 * player's profile from player_public_profile(): read-only, without coins, favourites and the diary.
 */
const props = defineProps<{ userId?: string }>()

const store = useProfileStore()
const auth = useAuthStore()
const clan = useClanStore()
const map = useMapStore()
const memories = useMemoriesStore()
const collection = useCollectionStore()
const areaQuests = useAreaQuestsStore()
const router = useRouter()

const settingsOpen = ref(false)
/** the diary slides out over the profile, like the clan and tasks sheets on the map */
const diaryOpen = ref(false)
// the clan card opens the same sheet as on the map (the /clan page stays the link target)
const clanOpen = ref(false)

const isOther = computed(() => !!props.userId && props.userId !== auth.userId)
const other = ref<PublicProfile | null>(null)
const otherLoading = ref(false)
const otherError = ref<ApiErrorCode | null>(null)

async function loadOther(): Promise<void> {
  if (!props.userId) return
  otherLoading.value = true
  otherError.value = null
  try {
    other.value = await services().api.getPublicProfile(props.userId)
  } catch (e) {
    other.value = null
    otherError.value = toApiError(e).code
  } finally {
    otherLoading.value = false
  }
}

/** server-side numbers (player_stats, player_progress); null until loaded or when the request failed — shown as «—» */
const ownStats = ref<PlayerStats | null>(null)
const ownProgress = ref<PlayerProgress | null>(null)
const stats = computed(() => (isOther.value ? (other.value?.stats ?? null) : ownStats.value))
const progress = computed<Pick<PlayerProgress, 'exploredCells' | 'exploredDistricts'> | null>(() =>
  isOther.value ? (other.value?.progress ?? null) : ownProgress.value,
)

const statsLoading = ref(false)
async function loadStats(): Promise<void> {
  const api = services().api
  statsLoading.value = true
  const [s, pr] = await Promise.allSettled([api.getPlayerStats(), api.getProgress()])
  ownStats.value = s.status === 'fulfilled' ? s.value : null
  ownProgress.value = pr.status === 'fulfilled' ? pr.value : null
  statsLoading.value = false
}
/** the okrugs (totals of «Локации района») are still on their way */
const districtsPending = ref(false)

/** okrugs with the shown player's discovered buildings (districts_overview counts only the viewer's) */
const districts = computed(() => {
  const found = other.value?.discoveredByDistrict
  if (!isOther.value || !found) return map.districts
  return map.districts.map((d) => ({ ...d, discoveredBuildings: found[d.id] ?? 0 }))
})

/**
 * «Ты открыл X% …» names the game area the player is in (HOME_AREA — Moscow, or Zavidovo with Moscow off —
 * when the position is unknown or outside every area). Another player's profile stays on Moscow: only
 * their okrug counts are public.
 */
const lastFix = ref<{ lat: number; lng: number } | null>(null)
const area = computed<GameAreaId>(() => {
  const at = map.position ?? lastFix.value
  return (!isOther.value && at && gameAreaAt(at)) || HOME_AREA
})
const areaProgress = ref<{ total: number; discovered: number } | null>(null)

async function locate(): Promise<void> {
  if (map.position) return
  try {
    const geo = services().geolocation
    if ((await geo.checkPermission()) !== 'granted') return
    lastFix.value = await geo.getCurrentPosition({ maxAgeMs: 5 * 60_000 })
  } catch {
    // stays on the home area
  }
}

watch(
  area,
  async (id) => {
    areaProgress.value = null
    if (id === 'moscow') return
    try {
      const progress = await services().api.getAreaProgress(id)
      if (area.value === id) areaProgress.value = progress
    } catch {
      // the card shows 0% until the next visit
    }
  },
  { immediate: true },
)

/** one explored cell is 0.0001° × 0.00018° ≈ 11.1 m × 11.3 m in Moscow */
const CELL_M2 = 125.6
const areaKm2 = computed(() => (progress.value ? (progress.value.exploredCells * CELL_M2) / 1e6 : null))
const fmtKm2 = (km2: number) => km2.toLocaleString('ru-RU', { maximumFractionDigits: km2 < 10 ? 2 : 1 })
/** «Локации района» shows placeholders instead of «—» until its numbers arrive */
const tilesLoading = computed(() => (isOther.value ? otherLoading.value : statsLoading.value) || districtsPending.value)

const okrugs = computed(() => {
  const total = map.districts.length
  const done = progress.value?.exploredDistricts ?? null
  return { done, total, percent: done !== null && total > 0 ? Math.round((done / total) * 100) : null }
})

const streets = computed(() => {
  const s = stats.value?.streets
  if (!s) return null
  return { ...s, percent: s.total > 0 ? Math.round((s.visited / s.total) * 100) : 0 }
})

const ACTIVITY_CELLS = 80
const MONTH_DAYS = 30
const DAY_MS = 86_400_000
/** last 80 days, oldest first; days are compared as Moscow dates from the server */
const activity = computed(() => {
  const st = stats.value
  if (!st) return Array.from({ length: ACTIVITY_CELLS }, () => false)
  const active = new Set(st.activeDays)
  const today = Date.parse(`${st.today}T00:00:00Z`)
  return Array.from({ length: ACTIVITY_CELLS }, (_, i) =>
    active.has(new Date(today - (ACTIVITY_CELLS - 1 - i) * DAY_MS).toISOString().slice(0, 10)),
  )
})
const monthActiveDays = computed(() => (stats.value ? activity.value.slice(-MONTH_DAYS).filter(Boolean).length : null))
/** «индекс активности»: share of the last 30 days with any game activity */
const sportIndex = computed(() => (monthActiveDays.value === null ? null : Math.round((monthActiveDays.value / MONTH_DAYS) * 100)))

const p = computed(() => (isOther.value ? (other.value?.profile ?? null) : store.profile))

const home = computed(() => districts.value.find((d) => d.id === p.value?.homeDistrictId) ?? null)
const title = computed(() => {
  if (!MOSCOW_ENABLED) return 'Исследователь Завидово'
  return home.value ? `Знаток ${home.value.shortName}` : 'Исследователь Москвы'
})

/** home district if the player has one, otherwise the whole city */
const places = computed(() => {
  const list = home.value ? [home.value] : districts.value
  const visited = list.reduce((sum, d) => sum + d.discoveredBuildings, 0)
  const total = list.reduce((sum, d) => sum + d.totalBuildings, 0)
  return { visited, total, percent: total > 0 ? Math.round((visited / total) * 100) : 0 }
})

/** achievements = server quests (progress, reward and claim are server-side) */
const quests = useQuestsStore()
/** someone else's achievements: no rewards to claim, so «completed» reads as done */
const achievementList = computed<QuestView[]>(() =>
  isOther.value
    ? (other.value?.achievements ?? []).map((a) => ({ ...a, reward: { xp: 0, coins: 0 }, claimedAt: a.completedAt, endsAt: null }))
    : quests.quests,
)
const sortedAchievements = computed(() => sortAchievements(achievementList.value))
const gotAchievements = computed(() => achievementList.value.filter((q) => q.completedAt).length)
const hasReward = computed(() => !isOther.value && quests.quests.some((q) => q.completedAt && !q.claimedAt))
const openQuestId = ref<string | null>(null)
const openQuest = computed(() => quests.quests.find((q) => q.id === openQuestId.value) ?? null)

const fmt = (n: number) => n.toLocaleString('ru-RU')
const dash = (n: number | null | undefined) => (n == null ? '—' : fmt(n))

const members = computed(() => clan.membership?.members ?? [])
/** up to 4 faces of the clanmates on the clan card; none without a clan */
const CLAN_FACES = 4
const clanFaces = computed(() => members.value.slice(0, CLAN_FACES))

const PLACEHOLDERS = 4
/** «Фото и заметки из AR»: the memories' photos, then the player's own scan photos of other buildings */
const diaryPhotos = computed(() => {
  const fromMemories = memories.items.flatMap((m) => {
    const url = memories.photoOf(m.buildingId)
    return url ? [{ id: m.id, url, name: m.buildingName, buildingId: m.buildingId }] : []
  })
  const withMemory = new Set(fromMemories.map((p) => p.buildingId))
  const fromScans = collection.items.flatMap((i) => {
    const url = i.photoPath ? collection.photoUrls.get(i.photoPath) : undefined
    return url && !withMemory.has(i.buildingId) ? [{ id: `scan:${i.buildingId}`, url, name: i.name, buildingId: i.buildingId }] : []
  })
  return [...fromMemories, ...fromScans]
})

/**
 * «Коллекция и артефакты»: mine are the Zavidovo artifact collections — the same as on the tasks page and
 * the collection page; another player's are their best finds (player_public_profile has no artifacts).
 */
const artifactCollections = computed(() =>
  (areaQuests.data?.collections ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    url: collectionPhoto(c.id),
    count: `${c.items.filter((i) => i.earnedAt).length}/${c.items.length}`,
  })),
)
const otherFinds = computed(() => (other.value?.bestFinds ?? []).map((f) => ({ id: f.buildingId, url: f.imageUrl, name: f.name })))

function openFavorites(): void {
  memories.favoritesOnly = true
  void router.push('/album')
}

onMounted(() => {
  if (map.districts.length === 0) {
    districtsPending.value = true
    void map.loadDistricts().finally(() => (districtsPending.value = false))
  }
  void clan.load()
  if (isOther.value) {
    void loadOther()
    return
  }
  if (!store.profile) void store.load()
  void memories.load()
  void collection.load()
  void areaQuests.load()
  void loadStats()
  void quests.load()
  void locate()
})

// one player's profile to another's: /profile and /players/:id are the same component, so the router
// keeps this instance — close whatever was open over the old profile (e.g. the clan sheet a clanmate
// was tapped in) and show the new one from its top
watch(
  () => props.userId,
  () => {
    clanOpen.value = false
    diaryOpen.value = false
    settingsOpen.value = false
    scrollToTopAfterLock()
    if (isOther.value) {
      void loadOther()
      return
    }
    // back to my own profile after someone else's: it may never have been loaded in this instance
    if (!store.profile) void store.load()
    void memories.load()
    void collection.load()
    void loadStats()
    void quests.load()
    void locate()
  },
)
</script>

<template>
  <main class="page profile">
    <StateBlock v-if="(isOther ? otherLoading : store.loading) && !p" kind="loading" />
    <template v-else-if="!p && isOther">
      <button class="back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <StateBlock
        v-if="otherError === 'profile_hidden'"
        kind="empty"
        title="Профиль скрыт"
        text="Профиль игрока видят только участники его клана."
      />
      <StateBlock v-else kind="error" title="Профиль не загружен" action-label="Повторить" @action="loadOther()" />
    </template>
    <StateBlock v-else-if="!p" kind="error" title="Профиль не загружен" action-label="Повторить" @action="store.load()" />
    <template v-else>
      <header class="head">
        <button v-if="isOther" class="back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
        <PlayerAvatar class="head__avatar" :url="p.avatarUrl" :figure="p.avatarKey" :name="p.username" :size="48" :letters="2" />
        <div class="head__who">
          <h1 class="head__name">{{ p.username }}</h1>
          <span class="head__title">{{ title }}</span>
        </div>
        <button v-if="!isOther" class="head__gear" aria-label="Настройки" @click="settingsOpen = true">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="gear-hole">
              <rect width="24" height="24" fill="#fff" />
              <circle cx="12" cy="12" r="2.8" fill="#000" />
            </mask>
            <g fill="currentColor" mask="url(#gear-hole)">
              <circle cx="12" cy="12" r="6.6" />
              <circle v-for="a in [0, 60, 120, 180, 240, 300]" :key="a" r="3.9" :cx="12 + 6.4 * Math.cos((a * Math.PI) / 180)" :cy="12 + 6.4 * Math.sin((a * Math.PI) / 180)" />
            </g>
          </svg>
        </button>
      </header>

      <div class="stats-row">
        <LevelProgress class="level" :level="p.level" :xp="p.xp" />
        <WalletStreak
          class="wallet"
          :class="{ 'wallet--streak': isOther }"
          :coins="!isOther && store.profile ? store.profile.coins : null"
          :streak="stats?.streakDays"
        />
      </div>

      <!-- mockup профиль.png: clan and favourites side by side, then the map -->
      <div class="duo" :class="{ 'duo--single': isOther }">
        <a href="/clan" class="clan" @click.prevent="clanOpen = true">
          <span class="clan__top">
            <ClanAvatar v-if="clan.membership" class="clan__crest" :url="clan.membership.clan.avatarUrl" :tag="clan.membership.clan.tag" :size="30" />
            <!-- no clan: a shield to join one, no grey «members» that look like an unloaded list -->
            <span v-else class="clan__crest clan__crest--none" aria-hidden="true"><AppIcon name="shield" :size="18" /></span>
            <span v-if="clanFaces.length" class="clan__faces" aria-hidden="true">
              <PlayerAvatar v-for="m in clanFaces" :key="m.userId" class="clan__face" :url="m.avatarUrl" :figure="m.avatarKey" :name="m.username" :size="30" />
            </span>
          </span>
          <h2 class="clan__name">{{ clan.membership ? `Клан «${clan.membership.clan.name}»` : 'Клан' }}</h2>
          <dl v-if="clan.membership" class="clan__stats">
            <div>
              <dt>Команда</dt>
              <dd>{{ members.length }}</dd>
            </div>
            <div>
              <dt>Открытий</dt>
              <dd>{{ dash(stats?.clan?.discoveries) }}</dd>
            </div>
          </dl>
          <p v-else class="clan__empty">Ты пока не в клане. <span class="clan__join">Найти команду</span></p>
        </a>

        <button v-if="!isOther" class="fav" @click="openFavorites">
          <span class="fav__icon"><AppIcon name="heart" :size="22" /></span>
          <AppIcon name="chevron" :size="20" class="fav__chev" />
          <span class="fav__title">Избранное</span>
        </button>
      </div>

      <!-- another player's share is public only for Moscow; with Moscow off their card would show mine -->
      <MoscowMapCard
        v-if="MOSCOW_ENABLED || !isOther"
        :districts="districts"
        :lead="isOther ? p.username : undefined"
        :area="area"
        :area-progress="areaProgress"
      />

      <!-- okrugs, Moscow streets: only with Moscow in the game -->
      <section v-if="MOSCOW_ENABLED" class="block">
        <div class="block__head">
          <h2>Локации района</h2>
          <RouterLink to="/map" class="more" aria-label="Открыть карту"><AppIcon name="chevron" :size="18" /></RouterLink>
        </div>
        <div class="tiles" :aria-busy="tilesLoading">
          <template v-if="tilesLoading">
            <div v-for="label in ['Посещено мест', 'Посещено улиц', 'Исследовано', 'Округов исследовано']" :key="label" class="tile">
              <p class="tile__label">{{ label }}</p>
              <p class="tile__num"><span class="skel skel--num" /></p>
              <p class="tile__foot"><span class="skel skel--foot" /></p>
            </div>
          </template>
          <template v-else>
            <div class="tile tile--in" style="--i: 0">
              <p class="tile__label">Посещено мест</p>
              <p class="tile__num"><CountUp :value="places.visited" /></p>
              <p class="tile__foot">
                <span>из {{ fmt(places.total) }} меток</span><b>{{ places.percent }}%</b>
              </p>
            </div>
            <div class="tile tile--in" style="--i: 1">
              <p class="tile__label">Посещено улиц</p>
              <p class="tile__num"><CountUp v-if="streets" :value="streets.visited" /><template v-else>—</template></p>
              <p class="tile__foot">
                <span>из {{ dash(streets?.total) }} улиц</span><b v-if="streets">{{ streets.percent }}%</b>
              </p>
            </div>
            <div class="tile tile--in" style="--i: 2">
              <p class="tile__label">Исследовано</p>
              <p class="tile__num">
                <template v-if="areaKm2 !== null"><CountUp :value="areaKm2" :format="fmtKm2" /><small> км²</small></template>
                <template v-else>—</template>
              </p>
              <p class="tile__foot">
                <span>{{ progress ? `${fmt(progress.exploredCells)} клеток карты` : '—' }}</span>
              </p>
            </div>
            <div class="tile tile--in" style="--i: 3">
              <p class="tile__label">Округов исследовано</p>
              <p class="tile__num"><CountUp v-if="okrugs.done !== null" :value="okrugs.done" /><template v-else>—</template></p>
              <p class="tile__foot">
                <span>из {{ fmt(okrugs.total) }} округов</span><b v-if="okrugs.percent !== null">{{ okrugs.percent }}%</b>
              </p>
            </div>
          </template>
        </div>
      </section>

      <section class="block">
        <h2>Спортивность</h2>
        <p class="block__sub">Индекс активности</p>
        <div class="sport" role="progressbar" :aria-valuenow="sportIndex ?? 0" aria-valuemax="100" aria-label="Индекс активности">
          <span v-if="sportIndex" class="sport__fill" :style="{ width: `${sportIndex}%` }">{{ sportIndex }}</span>
          <span class="sport__max">100</span>
        </div>
        <p class="sport__value">{{ dash(sportIndex) }} <small>/100</small></p>
      </section>

      <section class="block block--activity">
        <h3>Активность за месяц</h3>
        <div class="activity" aria-hidden="true" title="Последние 80 дней">
          <span v-for="(on, i) in activity" :key="i" :class="{ on }" />
        </div>
        <p class="block__sub">{{ daysText(monthActiveDays) }}</p>
      </section>

      <section v-if="!isOther" class="block block--bleed">
        <div class="block__head">
          <div>
            <h2>Дневник</h2>
            <p class="block__sub">Фото и заметки из AR</p>
          </div>
          <button class="more" aria-label="Открыть дневник" @click="diaryOpen = true"><AppIcon name="chevron" :size="18" /></button>
        </div>
        <div v-if="!memories.loaded && memories.loading" class="strip" aria-label="Загружаем дневник">
          <span v-for="i in PLACEHOLDERS" :key="`ds${i}`" class="strip__item strip__item--skeleton" />
        </div>
        <RouterLink v-else-if="diaryPhotos.length === 0" to="/scan" class="empty">
          <span class="empty__icon" aria-hidden="true"><AppIcon name="camera" :size="24" /></span>
          <span class="empty__text">
            <b>Здесь будут твои фото</b>
            <small>Сканируй здание в AR — снимок попадёт в дневник</small>
          </span>
          <span class="empty__cta">Открыть AR</span>
        </RouterLink>
        <div v-else class="strip">
          <img v-for="ph in diaryPhotos" :key="ph.id" class="strip__item" :src="ph.url" :alt="ph.name" />
          <span v-for="i in Math.max(0, PLACEHOLDERS - diaryPhotos.length)" :key="`d${i}`" class="strip__item strip__item--slot" aria-hidden="true">+</span>
        </div>
      </section>

      <section class="block block--bleed">
        <div class="block__head">
          <div>
            <h2>Достижения</h2>
            <p class="block__sub">
              {{ isOther ? 'Значки игрока' : hasReward ? 'Есть награда — нажми на значок' : 'Собирай значки, открывай новые статусы' }}
            </p>
          </div>
          <span v-if="quests.quests.length" class="block__count" :aria-label="`Получено ${gotAchievements} из ${quests.quests.length}`">
            {{ gotAchievements }}/{{ quests.quests.length }}
          </span>
        </div>
        <p v-if="!isOther && quests.error && !quests.loaded" class="block__sub">
          Не удалось загрузить достижения.
          <button class="link" @click="quests.load(true)">Повторить</button>
        </p>
        <div v-else class="strip strip--badges">
          <button
            v-for="q in sortedAchievements"
            :key="q.id"
            class="ach"
            :disabled="isOther"
            :aria-label="`${q.title}: ${q.completedAt ? (q.claimedAt ? 'получено' : 'есть награда') : `${q.progress} из ${q.target}`}`"
            @click="openQuestId = q.id"
          >
            <AchievementBadge :kind="badgeKind(q)" :label="q.title" :locked="!q.completedAt" aria-hidden="true" />
            <span v-if="q.completedAt && !q.claimedAt" class="ach__dot" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section class="block block--bleed">
        <div class="block__head">
          <div>
            <h2>Коллекция и артефакты</h2>
            <p class="block__sub">{{ isOther ? 'Лучшие находки' : 'Артефакты Завидово' }}</p>
          </div>
          <RouterLink v-if="!isOther" to="/collection" class="more" aria-label="Открыть коллекцию"><AppIcon name="chevron" :size="18" /></RouterLink>
        </div>
        <template v-if="isOther">
          <p v-if="otherFinds.length === 0" class="empty empty--quiet">
            <span class="empty__text"><small>Игрок пока ничего не открыл</small></span>
          </p>
          <div v-else class="strip">
            <template v-for="f in otherFinds" :key="f.id">
              <img v-if="f.url" class="strip__item" :src="f.url" :alt="f.name" />
              <span v-else class="strip__item strip__item--name">{{ f.name }}</span>
            </template>
          </div>
        </template>
        <div v-else-if="!areaQuests.data" class="strip" aria-label="Загружаем коллекции">
          <span v-for="i in PLACEHOLDERS" :key="`cs${i}`" class="strip__item strip__item--skeleton" />
        </div>
        <div v-else class="strip">
          <RouterLink
            v-for="c in artifactCollections"
            :key="c.id"
            to="/collection"
            class="strip__item strip__item--coll"
            :style="c.url ? { backgroundImage: `url(${c.url})` } : undefined"
          >
            <span class="strip__coll-name">«{{ c.title }}»</span>
            <span class="strip__coll-count">{{ c.count }}</span>
          </RouterLink>
        </div>
      </section>

    </template>

    <Transition name="sheet">
      <DiarySheet v-if="diaryOpen" @close="diaryOpen = false" />
    </Transition>
    <Transition name="sheet">
      <ClanSheet v-if="clanOpen" @close="clanOpen = false" />
    </Transition>
    <Transition name="sheet">
      <ProfileSettingsSheet v-if="settingsOpen" @close="settingsOpen = false" />
    </Transition>
    <Transition name="sheet">
      <AchievementSheet v-if="openQuest" :quest="openQuest" @close="openQuestId = null" />
    </Transition>

    <!-- the collection opened from here lies over the profile (child route) -->
    <PageOverlay />
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup
$blue: #0189ff;
$card: #f9f9fc;
$ink: #212529;
$gray: #6d6d6e;

.profile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: calc(var(--safe-top) + 30px);
  background: #fff;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.head__avatar {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #000;
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.head__who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.head__name {
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  color: #202020;
}
.head__title {
  padding: 1px 12px;
  border-radius: 4px;
  background: #e0eefc;
  color: #9da7b1;
  font-size: 13px;
  line-height: 17px;
}
.back {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f1f1f8;
  color: #000;
}
.head__gear {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: #2d264b;
}

.stats-row {
  display: grid;
  grid-template-columns: 175fr 176fr;
  gap: 7px;
}
.level,
.wallet {
  height: 40px;
  border-radius: 10px;
  background: $card;
}
.level {
  padding: 5px 12px;
}
.wallet {
  grid-template-columns: 78fr 98fr;
}
.wallet--streak {
  // someone else's profile: no coins, the streak takes the whole tile
  grid-template-columns: 1fr;
}

// clan and favourites side by side (mockup профиль.png: 177pt cards, 4pt gap, ~121pt high)
.duo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.duo--single .clan {
  grid-column: 1 / -1;
}
.clan,
.fav {
  display: flex;
  flex-direction: column;
  min-height: 121px;
  padding: 12px 10px 10px;
  border: 0;
  border-radius: 8px;
  background: #e3eefd;
  color: $ink;
  text-align: left;
  text-decoration: none;
}
.clan__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.clan__crest--none {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #cfe1f8;
  color: #0189ff;
}
.clan__faces {
  display: flex;
}
.clan__face {
  width: 30px;
  height: 30px;
  border: 2px solid #fff;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #d9d9d9;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  & + & {
    margin-left: -10px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.clan__name {
  margin-top: 12px;
  font-size: 15px;
  font-weight: 600;
  line-height: 19px;
  color: #000;
}
.clan__stats {
  display: flex;
  gap: 18px;
  margin-top: 6px;
  div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  dt {
    font-size: 11px;
    color: #6d6d6e;
  }
  dd {
    font-size: 15px;
    font-weight: 500;
    color: #000;
  }
}
.clan__empty {
  margin-top: 6px;
  font-size: 12px;
  color: #6d6d6e;
}
.clan__join {
  color: #0189ff;
  font-weight: 500;
}
.fav {
  position: relative;
}
.fav__icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: #b6d9fd;
  color: $blue;
}
.fav__chev {
  position: absolute;
  top: 12px;
  right: 10px;
  color: #a7b4c6;
}
.fav__title {
  margin-top: auto;
  font-size: 17px;
  font-weight: 500;
  color: #000;
}

.block {
  padding: 12px;
  border-radius: 16px;
  background: $card;
  h2 {
    font-size: 20px;
    font-weight: 600;
    line-height: 24px;
    color: #000;
  }
  h3 {
    font-size: 15px;
    font-weight: 500;
    color: #000;
  }
}
.block__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.block__sub {
  margin-top: 2px;
  font-size: 13px;
  color: $gray;
}
.block--bleed {
  // photo strips run off the right edge like in the mockup
  margin-right: -16px;
  border-radius: 16px 0 0 16px;
  .block__head {
    margin-right: 16px;
  }
}
.more {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #eeeef3;
  color: #000;
  &:disabled {
    color: #000;
    opacity: 1;
  }
}

.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.tile {
  display: flex;
  flex-direction: column;
  padding: 10px 12px 8px;
  border-radius: 10px;
  background: #fff;
}
.tile__label {
  font-size: 13px;
  color: #495057;
}
.tile__num {
  margin-top: 12px;
  font-size: 38px;
  font-weight: 700;
  line-height: 42px;
  color: $ink;
}
.tile__foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 2px;
  font-size: 11px;
  color: #6c757d;
  b {
    font-size: 13px;
    font-weight: 500;
    color: #22cc29;
  }
}

.sport {
  position: relative;
  display: flex;
  height: 24px;
  margin-top: 18px;
  border-radius: 12px;
  background: #e0eefc;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
}
.sport__fill {
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: $blue;
  color: #fff;
}
.sport__max {
  flex: 1;
  display: grid;
  place-items: center;
  color: $blue;
}
.sport__value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: $blue;
  small {
    font-size: 13px;
    font-weight: 500;
  }
}

.block--activity {
  padding: 16px 12px 12px;
}
.block__count {
  font-size: 15px;
  font-weight: 500;
  color: $gray;
}
// «Локации района» while loading: soft shimmering bars where the numbers go, then the tiles fade in one by one
.skel {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef0f4 0%, #f7f8fa 40%, #eef0f4 80%) 0 0 / 200% 100%;
  animation: skel 1.2s ease-in-out infinite;
}
.skel--num {
  width: 56px;
  height: 34px;
  margin: 4px 0;
}
.skel--foot {
  width: 80%;
  height: 11px;
  margin: 3px 0;
}
@keyframes skel {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}
.tile--in {
  animation: tile-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--i) * 60ms);
}
@keyframes tile-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .skel,
  .tile--in {
    animation: none;
  }
}
.tile__num small {
  font-size: 15px;
  font-weight: 500;
}
.activity {
  display: grid;
  grid-template-columns: repeat(20, 1fr);
  gap: 2px;
  margin: 12px 0 10px;
  span {
    aspect-ratio: 1;
    border-radius: 3px;
    background: #e0eefc;
    &.on {
      background: #7dc1fd;
    }
  }
}

.strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.strip__coll-name {
  font-size: 12px;
  font-weight: 600;
  line-height: 14px;
}
.strip__coll-count {
  font-size: 11px;
  opacity: 0.85;
}
.strip__item {
  flex: 0 0 88px;
  width: 88px;
  height: 108px;
  border-radius: 12px;
  background: #e3eefd;
  object-fit: cover;
  // a free place in the strip: an outline with a «+», not a grey block that looks unloaded
  &--slot {
    display: grid;
    place-items: center;
    border: 1.5px dashed #b9d4f3;
    background: transparent;
    font-size: 24px;
    font-weight: 300;
    color: #9ec2ec;
  }
  // a find without a photo: its name on a soft colour
  &--name {
    display: flex;
    align-items: flex-end;
    padding: 8px;
    background: linear-gradient(160deg, #6fb8f6, #2f86d9);
    font-size: 12px;
    font-weight: 600;
    line-height: 14px;
    color: #fff;
    overflow: hidden;
  }
  // an artifact collection: its cover, name and progress over a shade
  &--coll {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 2px;
    padding: 8px;
    overflow: hidden;
    background: #2d7fd6 center / cover no-repeat;
    color: #fff;
    text-decoration: none;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgb(0 0 0 / 0%) 35%, rgb(0 0 0 / 60%) 100%);
    }
    > * {
      position: relative;
    }
  }
  // still loading: a soft shimmer
  &--skeleton {
    background: linear-gradient(100deg, #eef1f6 30%, #f8f9fb 50%, #eef1f6 70%) 0 0 / 300% 100%;
    animation: strip-shimmer 1.3s ease-in-out infinite;
  }
}
@keyframes strip-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .strip__item--skeleton {
    animation: none;
  }
}
// nothing yet: one invitation instead of four empty tiles
.empty {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 108px;
  margin: 0;
  padding: 16px;
  border: 1.5px dashed #b9d4f3;
  border-radius: 12px;
  background: #f4f9ff;
  color: inherit;
  text-decoration: none;
  &--quiet {
    min-height: 0;
    justify-content: center;
  }
}
.empty__icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #dcecfc;
  color: #0189ff;
}
.empty__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  b {
    font-size: 15px;
    font-weight: 600;
    color: #000;
  }
  small {
    font-size: 13px;
    line-height: 17px;
    color: #6d6d72;
  }
}
.empty__cta {
  flex: none;
  padding: 8px 12px;
  border-radius: 10px;
  background: #0189ff;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.strip--badges {
  gap: 8px;
}
.ach {
  position: relative;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
}
.ach__dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #ff3b30;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: $blue;
  font: inherit;
}
</style>
