<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { plural } from '@/utils/plural'
import { type ApiError, type ApiErrorCode, toApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useEventsStore } from '@/stores/events'
import { useRouteStore } from '@/stores/route'
import type { GameEvent } from '@/types/game'
import { KIND_INFO, shortDate, weekdayClock } from './eventKinds'

/**
 * One event (mockup «Страница локации»). Only what the event really has is shown: programme, what to
 * bring, level, chat, reminder, reward and QR check-in from the mockup have no data yet.
 */
const props = defineProps<{ id: string }>()
const router = useRouter()
const auth = useAuthStore()
const feed = useEventsStore()

const event = ref<GameEvent | null>(null)
const loading = ref(true)
const loadError = ref<ApiError | null>(null)
const busy = ref(false)
const actionError = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    event.value = await services().api.getEvent(props.id)
  } catch (e) {
    loadError.value = toApiError(e)
  } finally {
    loading.value = false
  }
}

const startsAt = computed(() => (event.value ? new Date(event.value.startsAt) : null))
const started = computed(() => !!startsAt.value && startsAt.value.getTime() <= Date.now())
const isOrganizer = computed(() => !!event.value && event.value.organizer.userId === auth.userId)
const full = computed(() => !!event.value && event.value.participants >= event.value.maxParticipants)
const others = computed(() => (event.value ? Math.max(0, event.value.participants - event.value.faces.length) : 0))
/** the meeting point on our map, with the walking route to it; the route card leads back to the event */
const walk = useRouteStore()
function showOnMap(): void {
  const e = event.value
  if (!e) return
  walk.start(
    {
      id: `event:${e.id}`,
      slug: `event-${e.id}`,
      name: e.title,
      description: null,
      address: e.placeName,
      districtId: null,
      lat: e.lat,
      lng: e.lng,
      scanRadiusM: 60,
      rarity: 'common',
      reward: { xp: 0, coins: 0, influence: 0 },
      imageUrl: null,
      isDevSeed: false,
      discoveredAt: null,
    },
    `/events/${e.id}`,
  )
  void router.push('/map')
}

const ERRORS: Partial<Record<ApiErrorCode, string>> = {
  event_full: 'Мест больше нет.',
  event_started: 'Событие уже началось.',
  event_not_found: 'Событие удалено.',
  offline: 'Нет подключения к сети.',
}

async function toggle(): Promise<void> {
  if (!event.value || busy.value) return
  busy.value = true
  actionError.value = null
  try {
    const api = services().api
    await (event.value.joined ? api.leaveEvent(event.value.id) : api.joinEvent(event.value.id))
    await load()
    if (event.value) feed.replace(event.value)
  } catch (e) {
    actionError.value = ERRORS[toApiError(e).code] ?? 'Не удалось выполнить действие.'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page evd">
    <StateBlock v-if="loading && !event" kind="loading" />
    <StateBlock
      v-else-if="!event"
      kind="error"
      :title="loadError?.code === 'event_not_found' ? 'Событие не найдено' : 'Не удалось загрузить событие'"
      action-label="Повторить"
      @action="load"
    />
    <template v-else>
      <header class="hero">
        <img class="hero__art" :src="event.coverUrl ?? KIND_INFO[event.kind].art" alt="" />
        <button class="hero__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      </header>

      <div class="sheet">
        <span class="chip" :class="`chip--${KIND_INFO[event.kind].tone}`">
          <FilledIcon v-if="KIND_INFO[event.kind].tone === 'sport'" name="runner" :size="16" />
          {{ KIND_INFO[event.kind].label }}
        </span>
        <h1 class="title">{{ event.title }}</h1>

        <div class="facts">
          <div class="fact">
            <FilledIcon name="calendar" :size="20" class="fact__icon" />
            <span class="fact__text">
              <b>{{ shortDate(startsAt!) }}</b>
              <small>{{ weekdayClock(startsAt!) }}</small>
            </span>
          </div>
          <button type="button" class="fact" @click="showOnMap">
            <FilledIcon name="pin" :size="20" class="fact__icon" />
            <span class="fact__text">
              <b>{{ event.placeName ?? 'Точка на карте' }}</b>
            </span>
            <AppIcon name="chevron" :size="18" class="fact__chev" />
          </button>
          <div class="fact fact--wide">
            <FilledIcon name="profile" :size="20" class="fact__icon" />
            <span class="fact__text">
              <b>{{ event.participants }} {{ plural(event.participants, ['участник', 'участника', 'участников']) }}</b>
              <small>из {{ event.maxParticipants }}</small>
            </span>
          </div>
          <div class="fact fact--wide">
            <PlayerAvatar class="face face--sm" :url="event.organizer.avatarUrl" :figure="event.organizer.avatarKey" :name="event.organizer.username" :size="36" />
            <span class="fact__text">
              <small>Организатор</small>
              <b>{{ event.organizer.username }}</b>
            </span>
          </div>
        </div>

        <p v-if="event.description" class="desc">{{ event.description }}</p>

        <section class="who">
          <h2>Кто идет</h2>
          <div class="who__row">
            <span class="who__faces">
              <PlayerAvatar v-for="p in event.faces" :key="p.userId" class="face" :title="p.username" :url="p.avatarUrl" :figure="p.avatarKey" :name="p.username" :size="40" />
              <span v-if="others" class="face face--more">+{{ others }}</span>
            </span>
            <span class="who__total">Всего {{ event.participants }} {{ plural(event.participants, ['участник', 'участника', 'участников']) }}</span>
          </div>
        </section>

        <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>
        <div class="cta">
          <p v-if="isOrganizer" class="cta__note">Вы организатор этого события</p>
          <p v-else-if="started" class="cta__note">Событие уже началось</p>
          <AppButton v-else-if="event.joined" block variant="secondary" :loading="busy" @click="toggle">Отменить запись</AppButton>
          <AppButton v-else block :disabled="full" :loading="busy" @click="toggle">{{ full ? 'Мест нет' : 'Записаться' }}</AppButton>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (Страница локации.png)
$blue: #0189ff;
$card: #f2f2f7;

.evd {
  padding-top: 0;
  background: #fff;
}
.hero {
  position: relative;
  height: calc(var(--safe-top) + 260px);
  margin: 0 -16px;
}
.hero__art {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hero__back {
  position: absolute;
  top: calc(var(--safe-top) + 40px);
  left: 16px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #000;
}
.sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: -20px -16px 0;
  padding: 24px 16px 0;
  border-radius: 20px 20px 0 0;
  background: #fff;
}
.chip {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  &--sport {
    background: $blue;
  }
  &--culture {
    background: #9b51e0;
  }
  &--free {
    background: #22a45d;
  }
}
.title {
  font-size: 24px;
  font-weight: 600;
  line-height: 28px;
  color: #000;
}
.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.fact {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 8px;
  background: $card;
  color: inherit;
  text-decoration: none;
  width: 100%;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fact--wide {
  grid-column: 1 / -1;
}
.fact__icon {
  flex: none;
  color: $blue;
}
.fact__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  b {
    font-size: 15px;
    font-weight: 500;
    line-height: 18px;
    color: #000;
  }
  small {
    font-size: 13px;
    color: #6d6d6e;
  }
}
.fact__chev {
  flex: none;
  color: #8e8e93;
}
.desc {
  font-size: 16px;
  line-height: 21px;
  color: #000;
  white-space: pre-line;
}

.who {
  padding: 16px 14px;
  border-radius: 12px;
  background: #f9f9fc;
  h2 {
    font-size: 20px;
    font-weight: 600;
    color: #000;
  }
}
.who__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}
.who__faces {
  display: flex;
}
.face {
  flex: none;
  width: 40px;
  height: 40px;
  margin-left: -10px;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #e0eefc;
  color: $blue;
  font-size: 15px;
  font-weight: 700;
  &:first-child {
    margin-left: 0;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.face--sm {
  width: 36px;
  height: 36px;
  margin-left: 0;
}
.face--more {
  font-size: 13px;
}
.who__total {
  font-size: 13px;
  color: #6d6d6e;
}

.cta {
  position: sticky;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
  padding-top: 8px;
  :deep(button) {
    height: 50px;
  }
}
.cta__note {
  padding: 14px;
  border-radius: 10px;
  background: #f0f7ff;
  font-size: 14px;
  text-align: center;
  color: $blue;
}
</style>
