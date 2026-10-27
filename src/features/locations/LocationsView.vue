<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import nearbyArt from '@/assets/locations/nearby.webp'
import routesArt from '@/assets/locations/routes.webp'
import twoHoursArt from '@/assets/locations/two-hours.webp'
import type { MapBuilding } from '@/types/game'
import { swipeSession as swipe, usePlaces, walkTime as walkTimeFor } from './places'
import SwipeDeck from './SwipeDeck.vue'
import SwipeSetup, { type Range } from './SwipeSetup.vue'

const router = useRouter()
const { buildings, loading, error, load, loadAll, distance, photo, isFavorite, favBusy, toggleFavorite } = usePlaces()

// «С кем идешь?» does not filter yet: places have no such data
const RANGE_M: Record<Range, number> = { near: 1000, district: 5000, city: Infinity }

/** places within the chosen distance, nearest first; without a GPS fix the distance can't be checked, so all of them */
const inRange = computed(() => {
  const limit = swipe.range ? RANGE_M[swipe.range] : Infinity
  return [...buildings.value]
    .filter((b) => (distance(b) ?? 0) <= limit)
    .sort((a, b) => (distance(a) ?? 0) - (distance(b) ?? 0) || a.name.localeCompare(b.name, 'ru'))
})
const deck = computed(() => inRange.value.filter((b) => !swipe.seen.has(b.id)))

function startSwipe(range: Range): void {
  swipe.range = range
}
function markSeen(b: MapBuilding): void {
  swipe.seen.add(b.id)
}
function restartSwipe(): void {
  swipe.range = null
  swipe.seen.clear()
}

/**
 * Not available from the backend yet (buildings_in_bbox has no category, opening hours need the OSM id):
 * shown as in the mockup but inactive. Wire them up once the server provides the data.
 */
const STUB_CATEGORIES = ['Музеи', 'Парки', 'Кафе', 'Рестораны']

/** discovered first, then the nearest */
const list = computed(() =>
  [...buildings.value].sort((a, b) => {
    if (!!a.discoveredAt !== !!b.discoveredAt) return a.discoveredAt ? -1 : 1
    return (distance(a) ?? Infinity) - (distance(b) ?? Infinity) || a.name.localeCompare(b.name, 'ru')
  }),
)

const walkTime = (b: MapBuilding) => walkTimeFor(distance(b))

function openPlace(b: MapBuilding): void {
  void router.push({ name: 'location', params: { id: b.id } })
}

onMounted(loadAll)
</script>

<template>
  <main class="page loc">
    <header class="loc__head">
      <h1>Локации</h1>
      <button v-if="swipe.mode === 'gallery'" class="loc__filter" aria-label="Фильтры" disabled>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7" cy="7" r="2.4" fill="currentColor" />
          <rect x="11" y="6" width="9" height="2" rx="1" fill="currentColor" />
          <circle cx="17" cy="17" r="2.4" fill="currentColor" />
          <rect x="4" y="16" width="9" height="2" rx="1" fill="currentColor" />
        </svg>
      </button>
    </header>

    <div class="seg" :class="{ 'seg--swipe': swipe.mode === 'swipe' }" role="tablist" aria-label="Режим">
      <span class="seg__thumb" aria-hidden="true" />
      <button role="tab" :aria-selected="swipe.mode === 'gallery'" :class="{ on: swipe.mode === 'gallery' }" @click="swipe.mode = 'gallery'">Галерея</button>
      <button role="tab" :aria-selected="swipe.mode === 'swipe'" :class="{ on: swipe.mode === 'swipe', dark: swipe.mode === 'swipe' }" @click="swipe.mode = 'swipe'">Свайп</button>
    </div>

    <!-- the content slides the way the tab moved: Свайп is to the right of Галерея -->
    <Transition :name="swipe.mode === 'swipe' ? 'mode-fwd' : 'mode-back'" mode="out-in">
      <div :key="swipe.mode" class="loc__mode">
        <div v-if="swipe.mode === 'gallery'" class="chips" role="group" aria-label="Категории">
          <button class="chip on" aria-pressed="true">Все ({{ buildings.length }})</button>
          <button v-for="c in STUB_CATEGORIES" :key="c" class="chip" disabled>{{ c }}</button>
        </div>

        <template v-if="swipe.mode === 'swipe'">
          <SwipeSetup v-if="!swipe.range" @next="(c) => startSwipe(c.range)" />
          <StateBlock v-else-if="loading && buildings.length === 0" kind="loading" title="Загружаем места…" />
          <StateBlock
            v-else-if="error"
            kind="error"
            :title="error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
            action-label="Повторить"
            @action="load()"
          />
          <StateBlock
            v-else-if="deck.length === 0"
            kind="empty"
            :title="inRange.length ? 'Места закончились' : 'Поблизости мест нет'"
            :text="inRange.length ? undefined : 'Попробуй выбрать расстояние побольше.'"
            action-label="Изменить ответы"
            @action="restartSwipe"
          />
          <SwipeDeck
            v-else
            :places="deck"
            :photo="photo"
            :is-favorite="isFavorite"
            :fav-busy="favBusy"
            @open="openPlace"
            @favorite="toggleFavorite"
            @seen="markSeen"
          />
        </template>
        <template v-else>
          <section>
            <div class="loc__row">
              <h2>Подборки</h2>
              <button class="more" aria-label="Все подборки" disabled><AppIcon name="chevron" :size="18" /></button>
            </div>
            <div class="picks">
              <div class="pick pick--blue" :style="{ backgroundImage: `url(${nearbyArt})` }">
                <p>Возле тебя<br />сейчас</p>
                <RouterLink to="/map" class="pick__go" aria-label="Возле тебя сейчас: открыть карту"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h15m-4.5-4.5 4.5 4.5-4.5 4.5" /></svg></RouterLink>
              </div>
              <div class="pick pick--yellow" :style="{ backgroundImage: `url(${twoHoursArt})` }">
                <p>Маршруты на<br />2 часа</p>
                <button class="pick__go" aria-label="Маршруты на 2 часа" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h15m-4.5-4.5 4.5 4.5-4.5 4.5" /></svg></button>
              </div>
              <div class="pick pick--pink">
                <p>Для дождливого<br />дня</p>
                <button class="pick__go" aria-label="Для дождливого дня" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h15m-4.5-4.5 4.5 4.5-4.5 4.5" /></svg></button>
              </div>
            </div>
          </section>

          <section>
            <div class="loc__row">
              <h2>Локации</h2>
              <RouterLink to="/map" class="more" aria-label="Открыть карту"><AppIcon name="chevron" :size="18" /></RouterLink>
            </div>

            <StateBlock v-if="loading && buildings.length === 0" kind="loading" title="Загружаем места…" />
            <StateBlock
              v-else-if="error"
              kind="error"
              :title="error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
              action-label="Повторить"
              @action="load()"
            />
            <StateBlock v-else-if="list.length === 0" kind="empty" title="Мест пока нет" />
            <ul v-else class="places">
              <li v-for="b in list" :key="b.id" class="place">
                <div class="place__photo" role="button" tabindex="0" :aria-label="`${b.name}: подробнее`" @click="openPlace(b)" @keydown.enter="openPlace(b)">
                  <img v-if="photo(b)" :src="photo(b)!" alt="" />
                </div>
                <button
                  v-if="b.discoveredAt"
                  class="place__fav"
                  :class="{ on: isFavorite(b) }"
                  :aria-pressed="isFavorite(b)"
                  :aria-label="isFavorite(b) ? 'Убрать из избранного' : 'В избранное'"
                  :disabled="favBusy === b.id"
                  @click="toggleFavorite(b)"
                >
                  <AppIcon name="heart" :size="20" />
                </button>
                <h3 class="place__name">{{ b.name }}</h3>
                <p v-if="b.address" class="place__meta"><FilledIcon name="pin" :size="16" />{{ b.address }}</p>
                <p v-if="walkTime(b)" class="place__meta"><FilledIcon name="runner" :size="16" />{{ walkTime(b) }}</p>
              </li>
            </ul>
          </section>

          <RouterLink to="/routes" class="routes" :style="{ backgroundImage: `url(${routesArt})` }">
            <h2>Авторские маршруты</h2>
            <p>Квесты по Завидово: набережная,<br />«Ямской лес» и Государева дорога</p>
            <span class="routes__soon">Открыть</span>
          </RouterLink>
        </template>
      </div>
    </Transition>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (локации.png, 3x)
$card: #f3f3f9;

.loc {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: calc(var(--safe-top) + 32px);
  background: #fff;
  // the mode switch slides content sideways; no horizontal scroll while it moves
  overflow-x: clip;
  h2 {
    font-size: 24px;
    font-weight: 600;
    line-height: 28px;
    color: #000;
  }
}
.loc__head {
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
.loc__filter {
  width: 52px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #f9f9fc;
  color: #1c1c1e;
  &:disabled {
    opacity: 1;
  }
}

.seg {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 40px;
  margin-top: 8px;
  padding: 2px;
  border-radius: 10px;
  background: #f9f9fc;
  button {
    position: relative; // above the thumb
    border: 0;
    border-radius: 8px;
    background: none;
    color: #b9babc;
    font-size: 14px;
    font-weight: 500;
    transition: color 0.3s var(--ease);
    &.on {
      color: #232526;
    }
    // the swipe mockup (тиндер.png) shows its active tab in black
    &.dark {
      color: #fff;
    }
  }
}
// the active tab's background: one pill that slides between the tabs and changes colour on the way
.seg__thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: 8px;
  background: #ebebeb;
  transition:
    transform 0.38s cubic-bezier(0.34, 1.2, 0.5, 1),
    background-color 0.3s var(--ease);
  .seg--swipe & {
    transform: translateX(100%);
    background: #000;
  }
}

// switching Галерея ⇄ Свайп: the old content fades out sideways, the new one comes in from the other side
.loc__mode {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mode-fwd-enter-active,
.mode-back-enter-active {
  transition:
    opacity 0.24s var(--ease),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.mode-fwd-leave-active,
.mode-back-leave-active {
  transition:
    opacity 0.14s ease-in,
    transform 0.14s ease-in;
}
.mode-fwd-enter-from,
.mode-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.mode-fwd-leave-to,
.mode-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
@media (prefers-reduced-motion: reduce) {
  .seg__thumb,
  .mode-fwd-enter-active,
  .mode-back-enter-active,
  .mode-fwd-leave-active,
  .mode-back-leave-active {
    transition-duration: 0.01s;
  }
}

.chips {
  display: flex;
  gap: 6px;
  margin-right: -16px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.chip {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: #f9f9fc;
  color: #b9babc;
  font-size: 13px;
  white-space: nowrap;
  &.on {
    background: #ebebeb;
    color: #232526;
  }
  &:disabled {
    opacity: 1;
  }
}

.loc__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 0 16px;
}
.more {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f3f3f9;
  color: #000;
  &:disabled {
    opacity: 1;
  }
}

.picks {
  display: flex;
  gap: 8px;
  margin-right: -16px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.pick {
  position: relative;
  flex: 0 0 140px;
  height: 120px;
  padding: 12px;
  border-radius: 8px;
  overflow: hidden;
  background-size: cover;
  background-position: center;
  p {
    position: relative;
    font-size: 15px;
    font-weight: 500;
    line-height: 18px;
    letter-spacing: -0.02em;
    white-space: nowrap; // line breaks are set in the markup, as in the mockup
  }
  &--blue {
    background-color: #0189ff;
    color: #fff;
  }
  &--yellow {
    background-color: #ffe27e;
    color: #000;
  }
  &--pink {
    background-color: #f9b7fd;
    color: #000;
  }
}
.pick__go {
  position: absolute;
  left: 12px;
  bottom: 12px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #000;
  text-decoration: none;
  &:disabled {
    opacity: 1;
  }
}

.places {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.place {
  position: relative;
  padding: 8px 8px 14px;
  border-radius: 12px;
  background: $card;
}
.place__photo {
  position: relative;
  height: 160px;
  border-radius: 8px;
  overflow: hidden;
  background: #d5d1d1;
  cursor: pointer;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.place__fav {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #c7c7cc;
  &.on {
    color: #ff3b6b;
    :deep(path) {
      fill: currentColor;
    }
  }
}
.place__name {
  margin: 14px 4px 4px;
  font-size: 17px;
  font-weight: 500;
  color: #000;
}
.place__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 4px 0;
  font-size: 13px;
  color: #85858c;
  svg {
    flex: none;
    color: #0189ff;
  }
}

.routes {
  position: relative;
  display: block;
  height: 154px;
  color: inherit;
  text-decoration: none;
  margin-top: 10px;
  padding: 14px 12px;
  border-radius: 12px;
  background-color: #e3eefd;
  background-size: cover;
  background-position: center;
  h2 {
    font-size: 15px;
    font-weight: 500;
    line-height: 18px;
  }
  p {
    margin-top: 4px;
    font-size: 13px;
    line-height: 15px;
    color: #72777f;
  }
}
.routes__soon {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #0189ff;
}
</style>
