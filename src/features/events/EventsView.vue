<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import CategoryChips from '@/components/ui/CategoryChips.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useEventsStore } from '@/stores/events'
import { useMapStore } from '@/stores/map'
import type { GameEvent } from '@/types/game'
import { distanceMeters } from '@/utils/geo'
import PickerSheet from './PickerSheet.vue'
import {
  clock,
  type EventFilters,
  feedWhen,
  filtersActive,
  isSameMoscowDay,
  KIND_CHIPS,
  KIND_INFO,
  matchesFilters,
  NO_FILTERS,
  shortDate,
  WHEN_OPTIONS,
} from './eventKinds'

/**
 * Events of the players (events_feed, migration 018), laid out as in the mockup (иветы.png):
 * today's events as big cards (nearest first when the player's position is known), the later ones
 * as a list. The type chips and the filter sheet (date, free places, mine) narrow the feed.
 */
const events = useEventsStore()
const map = useMapStore()

const kind = ref<string | null>(null)
const filters = ref<EventFilters>({ ...NO_FILTERS })

const now = new Date()
const shown = computed(() =>
  events.items.filter((e) => (kind.value === null || e.kind === kind.value) && matchesFilters(e, filters.value, now)),
)

/** metres from the player, when the map knows where they are */
const distance = (e: GameEvent) => (map.position ? distanceMeters(map.position, e) : null)
function distanceText(e: GameEvent): string | null {
  const m = distance(e)
  if (m === null) return null
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} м` : `${(m / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`
}
const today = computed(() => {
  const list = shown.value.filter((e) => isSameMoscowDay(new Date(e.startsAt), now))
  return map.position ? [...list].sort((a, b) => (distance(a) ?? 0) - (distance(b) ?? 0)) : list
})
const upcoming = computed(() => shown.value.filter((e) => !isSameMoscowDay(new Date(e.startsAt), now)))
const art = (e: GameEvent) => e.coverUrl ?? KIND_INFO[e.kind].art
const seatsLeft = (e: GameEvent) => Math.max(0, e.maxParticipants - e.participants)
const seatsText = (e: GameEvent, prefix: string) => (e.joined ? 'Вы идёте' : `${prefix} ${seatsLeft(e)} из ${e.maxParticipants}`)
const placeText = (e: GameEvent) => [distanceText(e), e.placeName ?? 'Точка на карте'].filter(Boolean).join(' · ')

// the filter sheet edits a draft; «Применить» takes it over
const sheetOpen = ref(false)
const draft = ref<EventFilters>({ ...NO_FILTERS })
function openFilters(): void {
  draft.value = { ...filters.value }
  sheetOpen.value = true
}
function applyFilters(): void {
  filters.value = { ...draft.value }
  sheetOpen.value = false
}
function resetAll(): void {
  kind.value = null
  filters.value = { ...NO_FILTERS }
}

onMounted(() => void events.load())
</script>

<template>
  <main class="page ev">
    <header class="ev__head">
      <h1>Ивенты</h1>
      <div class="ev__actions">
        <button class="ev__filter" :class="{ 'ev__filter--on': filtersActive(filters) }" aria-label="Фильтры" @click="openFilters">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="7" cy="7" r="2.4" fill="currentColor" />
            <rect x="11" y="6" width="9" height="2" rx="1" fill="currentColor" />
            <circle cx="17" cy="17" r="2.4" fill="currentColor" />
            <rect x="4" y="16" width="9" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>
        <RouterLink to="/events/new" class="ev__filter ev__new" aria-label="Создать событие">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </RouterLink>
      </div>
    </header>

    <CategoryChips v-model="kind" :items="KIND_CHIPS" />

    <p v-if="events.error && events.loaded" class="ev__error" role="alert">
      Не удалось обновить события.
      <button class="link" @click="events.load()">Повторить</button>
    </p>

    <!-- loading / empty / nothing found / the feed replace each other with a short fade -->
    <Transition name="feed" mode="out-in">
      <StateBlock v-if="!events.loaded && events.error" kind="error" title="Не удалось загрузить события" action-label="Повторить" @action="events.load()" />
      <StateBlock v-else-if="!events.loaded" kind="loading" />
      <div v-else-if="events.items.length === 0" class="ev__empty">
        <StateBlock kind="empty" title="Пока событий нет" text="Соберите людей на пробежку, прогулку, чтение или субботник — создайте первое событие." />
        <RouterLink to="/events/new" class="ev__cta">Создать событие</RouterLink>
      </div>
      <StateBlock v-else-if="shown.length === 0" kind="empty" title="Ничего не нашлось" text="Под выбранные фильтры событий нет." action-label="Сбросить фильтры" @action="resetAll" />

      <div v-else class="ev__feed">
        <Transition name="feed">
          <section v-if="today.length">
            <div class="ev__row">
              <h2>{{ map.position ? 'Сегодня рядом' : 'Сегодня' }}</h2>
            </div>
            <TransitionGroup name="card" tag="div" class="today">
              <RouterLink v-for="(e, i) in today" :key="e.id" :to="`/events/${e.id}`" class="big" :style="{ '--i': i }">
                <img class="big__art" :src="art(e)" alt="" />
                <span class="big__shade" aria-hidden="true" />
                <span class="tag" :class="`tag--${KIND_INFO[e.kind].tone}`">{{ KIND_INFO[e.kind].label }}</span>
                <div class="big__when">
                  <span class="glass"><FilledIcon name="calendar" :size="14" />{{ shortDate(new Date(e.startsAt)) }}</span>
                  <span class="glass">
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="currentColor" fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm.9 4.5a.9.9 0 0 0-1.8 0V12c0 .3.1.5.3.7l3 2.5a.9.9 0 1 0 1.2-1.4l-2.7-2.2V7.5Z" />
                    </svg>
                    {{ clock(new Date(e.startsAt)) }}
                  </span>
                </div>
                <h3 class="big__title">{{ e.title }}</h3>
                <div class="big__faces" aria-hidden="true">
                  <PlayerAvatar v-for="p in e.faces" :key="p.userId" class="face" :url="p.avatarUrl" :figure="p.avatarKey" :name="p.username" :size="32" />
                </div>
                <div class="big__foot">
                  <span class="glass">{{ seatsText(e, 'Осталось') }}</span>
                  <span class="glass glass--place"><FilledIcon name="pin" :size="14" />{{ placeText(e) }}</span>
                </div>
              </RouterLink>
            </TransitionGroup>
          </section>
        </Transition>

        <Transition name="feed">
          <section v-if="upcoming.length">
            <div class="ev__row">
              <h2>Ближайшие события</h2>
            </div>
            <TransitionGroup name="card" tag="ul" class="list">
              <li v-for="(e, i) in upcoming" :key="e.id" :style="{ '--i': i }">
                <RouterLink :to="`/events/${e.id}`" class="item">
                  <img class="item__art" :src="art(e)" alt="" />
                  <div class="item__body">
                    <p class="item__top">
                      <span class="pill" :class="`pill--${KIND_INFO[e.kind].tone}`">{{ KIND_INFO[e.kind].label }}</span>
                      <span class="item__when">{{ feedWhen(new Date(e.startsAt)) }}</span>
                    </p>
                    <h3 class="item__title">{{ e.title }}</h3>
                    <p class="item__foot">
                      <span class="item__faces" aria-hidden="true">
                        <PlayerAvatar v-for="p in e.faces" :key="p.userId" class="face face--xs" :url="p.avatarUrl" :figure="p.avatarKey" :name="p.username" :size="22" />
                      </span>
                      <span v-if="e.participants > e.faces.length" class="item__more">+{{ e.participants - e.faces.length }}</span>
                      <span class="item__sep" />
                      <span class="item__reward">{{ seatsText(e, 'Мест:') }}</span>
                    </p>
                  </div>
                  <AppIcon name="chevron" :size="20" class="item__chev" />
                </RouterLink>
              </li>
            </TransitionGroup>
          </section>
        </Transition>
      </div>
    </Transition>

    <!-- to the body: inside the page it would sit under the tab bar -->
    <Teleport to="body">
      <Transition name="sheet">
        <PickerSheet
          v-if="sheetOpen"
          title="Фильтры"
          :can-reset="filtersActive(draft)"
          @close="sheetOpen = false"
          @reset="draft = { ...NO_FILTERS }"
          @apply="applyFilters"
        >
          <div class="fl" role="group" aria-label="Когда">
            <p class="fl__title">Когда</p>
            <div class="fl__opts">
              <button
                v-for="o in WHEN_OPTIONS"
                :key="o.id"
                type="button"
                class="fl__opt"
                :aria-pressed="draft.when === o.id"
                @click="draft.when = o.id"
              >
                {{ o.label }}
              </button>
            </div>
          </div>
          <label class="fl__switch">
            <span>Есть свободные места</span>
            <input v-model="draft.freeSeats" type="checkbox" role="switch" />
          </label>
          <label class="fl__switch">
            <span>Только мои события</span>
            <input v-model="draft.mine" type="checkbox" role="switch" />
          </label>
        </PickerSheet>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (иветы.png, 3x)
.ev {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: calc(var(--safe-top) + 32px);
  background: #fff;
  h2 {
    font-size: 24px;
    font-weight: 600;
    line-height: 28px;
    color: #000;
  }
}
.ev__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  h1 {
    font-size: 34px;
    font-weight: 700;
    line-height: 40px;
    letter-spacing: -0.01em;
    color: #000;
  }
}
.ev__filter {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f9f9fc;
  color: #1c1c1e;
}
// filters applied: a blue dot in the corner
.ev__filter--on {
  position: relative;
  color: #0189ff;
  &::after {
    content: '';
    position: absolute;
    top: 7px;
    right: 7px;
    width: 8px;
    height: 8px;
    border: 2px solid #f9f9fc;
    border-radius: 50%;
    background: #0189ff;
  }
}

.ev__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 0 16px;
}

// filters and chips: the feed fades between its states, cards come in one after another and the rest
// slide to their new places
.ev__feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.feed-enter-active {
  transition:
    opacity 0.28s ease,
    transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
.feed-leave-active {
  transition: opacity 0.14s ease-in;
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.feed-leave-to {
  opacity: 0;
}
.card-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: calc(min(var(--i, 0), 6) * 40ms);
}
.card-leave-active {
  transition: opacity 0.14s ease-in;
}
.card-move {
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.card-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
.card-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .feed-enter-active,
  .feed-leave-active,
  .card-enter-active,
  .card-leave-active,
  .card-move {
    transition-duration: 0.01s;
    transition-delay: 0s;
  }
}
.today {
  display: flex;
  gap: 8px;
  margin-right: -16px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.big {
  position: relative;
  display: block;
  flex: 0 0 322px;
  text-decoration: none;
  height: 220px;
  padding: 8px 12px 8px;
  border-radius: 10px;
  overflow: hidden;
  color: #fff;
  background: #7cc4f5;
}
.big__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.big__shade {
  // keeps the white title readable over any artwork, as the darker lower half in the mockup
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(0 0 0 / 0%) 30%, rgb(0 0 0 / 35%) 100%);
}
.tag {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 16px;
  &--sport {
    background: #0189ff;
    color: #fff;
  }
  &--culture {
    background: #f9b7fd;
    color: #2a1630;
  }
  &--free {
    background: #22a45d;
    color: #fff;
  }
}
.glass {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgb(52 64 84 / 45%);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-size: 13px;
  white-space: nowrap;
}
.big__when {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
}
.big__title {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 98px;
  font-size: 20px;
  font-weight: 600;
  line-height: 22px;
  white-space: pre-line;
  text-shadow: 0 1px 8px rgb(0 0 0 / 25%);
}
.big__faces {
  position: absolute;
  left: 12px;
  top: 150px;
  display: flex;
}
.big__foot {
  position: absolute;
  left: 12px;
  right: 8px;
  bottom: 8px;
  display: flex;
  justify-content: space-between;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  color: inherit;
  text-decoration: none;
  align-items: center;
  gap: 12px;
  padding: 7px 10px 7px 8px;
  border-radius: 12px;
  background: #f8f8fe;
}
.item__art {
  flex: 0 0 90px;
  width: 90px;
  height: 101px;
  border-radius: 8px;
  object-fit: cover;
}
.item__body {
  flex: 1;
  min-width: 0;
}
.item__top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pill {
  padding: 2px 10px;
  border-radius: 5px;
  font-size: 13px;
  line-height: 16px;
  color: #222;
  &--free {
    background: #e5f6e1;
  }
  &--sport {
    background: #dcecff;
  }
  &--kids {
    background: #fdf0c9;
  }
  &--culture {
    background: #f0dcf9;
  }
}
.item__when {
  font-size: 13px;
  color: #9a9a9f;
}
.item__title {
  margin-top: 10px;
  overflow: hidden;
  font-size: 15px;
  letter-spacing: -0.01em;
  font-weight: 500;
  line-height: 20px;
  color: #000;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.item__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  margin-top: 10px;
  font-size: 13px;
  color: #9a9a9f;
}
.item__faces {
  display: flex;
}
.item__sep {
  width: 1px;
  height: 20px;
  background: #d9d9de;
}
.item__reward {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.item__chev {
  flex: none;
  color: #b5b5ba;
}
.ev__actions {
  display: flex;
  gap: 8px;
}
.ev__new {
  color: #0189ff;
  text-decoration: none;
}
.ev__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ev__cta {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 22px;
  border-radius: var(--r-pill);
  background: #0189ff;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

// filter sheet
.fl__title {
  margin-bottom: 8px;
  font-size: 13px;
  color: #6d6d6e;
}
.fl__opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fl__opt {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: #fff;
  color: #000;
  font-size: 14px;
  font-weight: 500;
  &[aria-pressed='true'] {
    background: #0189ff;
    color: #fff;
  }
}
.fl__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  font-size: 15px;
  color: #000;
  input {
    width: 20px;
    height: 20px;
    accent-color: #0189ff;
  }
}
.ev__error {
  font-size: 13px;
  color: #d93025;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: #0189ff;
  font: inherit;
}
.face {
  flex: none;
  width: 32px;
  height: 32px;
  overflow: hidden;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e0eefc;
  color: #0189ff;
  font-size: 13px;
  font-weight: 700;
  & + & {
    margin-left: -12px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.face--xs {
  width: 22px;
  height: 22px;
  font-size: 10px;
  & + & {
    margin-left: -10px;
  }
}
.glass--place {
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
