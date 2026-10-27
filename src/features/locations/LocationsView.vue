<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import nearbyArt from '@/assets/locations/nearby.webp'
import twoHoursArt from '@/assets/locations/two-hours.webp'
import CategoryChips from '@/components/ui/CategoryChips.vue'
import { hasPoint, PLACE_CHIPS, placeBadges, placeTarget } from '@/features/routes/routes'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import type { MapBuilding, PlaceTag } from '@/types/game'
import { swipeSession as swipe, usePlaces, walkTime as walkTimeFor } from './places'
import SwipeDeck from './SwipeDeck.vue'
import SwipeSetup, { type Range } from './SwipeSetup.vue'

const router = useRouter()
const { buildings, loading, error, load, loadAll, distance, photo: buildingPhoto, isFavorite, favBusy, toggleFavorite } = usePlaces()

// Zavidovo places (area_places) shown as location cards: `place:<id>`, photo and description of the place
const quests = useAreaQuestsStore()
const zavCards = computed(() =>
  (quests.data?.places ?? []).filter(hasPoint).map((p) => ({ card: placeTarget(p), place: p })),
)
const zavCategory = computed(() => new Map(zavCards.value.map((z) => [z.card.id, z.place.category])))
const isZav = (b: MapBuilding) => b.id.startsWith('place:')
const photo = (b: MapBuilding) => (isZav(b) ? b.imageUrl : buildingPhoto(b))
const tagOf = (b: MapBuilding) => zavCategory.value.get(b.id) ?? null
/** kind + type badges over the photo (mockup Location_Gallery); Moscow buildings have none yet */
const zavBadges = computed(() => new Map(zavCards.value.map((z) => [z.card.id, placeBadges(z.place)])))
const badgesOf = (b: MapBuilding) => zavBadges.value.get(b.id) ?? null

// «С кем идешь?» does not filter yet: places have no such data
const RANGE_M: Record<Range, number> = { near: 1000, district: 5000, city: Infinity }

/** places within the chosen distance, nearest first; without a GPS fix the distance can't be checked, so all of them */
const inRange = computed(() => {
  const limit = swipe.range ? RANGE_M[swipe.range] : Infinity
  return [...buildings.value, ...zavCards.value.map((z) => z.card)]
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
 * The category chips of the map and the places tab. Only Zavidovo places have categories
 * (area_places.tags); Moscow buildings have none yet, so a chosen category shows Zavidovo places.
 */
const category = ref<PlaceTag | null>(null)
const zavTags = computed(() => new Map(zavCards.value.map((z) => [z.card.id, z.place.tags])))
const inCategory = (b: MapBuilding) => !category.value || (zavTags.value.get(b.id)?.includes(category.value) ?? false)

/** Moscow buildings and Zavidovo places in one list: discovered first, then the nearest */
const list = computed(() =>
  [...buildings.value, ...zavCards.value.map((z) => z.card)].filter(inCategory).sort((a, b) => {
    if (!!a.discoveredAt !== !!b.discoveredAt) return a.discoveredAt ? -1 : 1
    return (distance(a) ?? Infinity) - (distance(b) ?? Infinity) || a.name.localeCompare(b.name, 'ru')
  }),
)

const walkTime = (b: MapBuilding) => walkTimeFor(distance(b))

function openPlace(b: MapBuilding): void {
  if (isZav(b)) void router.push({ name: 'place', params: { id: b.slug } })
  else void router.push({ name: 'location', params: { id: b.id } })
}

// back from a place page the list opens where the player left it, not at the top
onBeforeRouteLeave(() => {
  swipe.scrollY = window.scrollY
})
/** once there is enough list to scroll that far (the cached places show at once; else after loading) */
function restoreScroll(): void {
  const y = swipe.scrollY
  if (y <= 0) return
  const stop = watch(
    () => loading.value && buildings.value.length === 0,
    (waiting) => {
      if (waiting) return
      void nextTick(() => {
        window.scrollTo({ top: y })
        stop?.()
      })
    },
    { immediate: true },
  )
}

onMounted(() => {
  loadAll()
  void quests.load()
  restoreScroll()
})
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
      <button role="tab" :aria-selected="swipe.mode === 'swipe'" :class="{ on: swipe.mode === 'swipe' }" @click="swipe.mode = 'swipe'">Свайп</button>
    </div>

    <!-- the content slides the way the tab moved: Свайп is to the right of Галерея -->
    <Transition :name="swipe.mode === 'swipe' ? 'mode-fwd' : 'mode-back'" mode="out-in">
      <div :key="swipe.mode" class="loc__mode">
        <CategoryChips v-if="swipe.mode === 'gallery'" v-model="category" :items="PLACE_CHIPS" />

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
            :tag-of="tagOf"
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
            <StateBlock v-else-if="list.length === 0" kind="empty" :title="category ? 'В этой категории мест пока нет' : 'Мест пока нет'" />
            <ul v-else class="places">
              <li v-for="b in list" :key="b.id" class="place">
                <div class="place__photo" role="button" tabindex="0" :aria-label="`${b.name}: подробнее`" @click="openPlace(b)" @keydown.enter="openPlace(b)">
                  <img v-if="photo(b)" :src="photo(b)!" alt="" />
                  <div v-if="badgesOf(b)" class="place__badges">
                    <span class="place__badge" :class="`place__badge--${badgesOf(b)!.kind}`">{{ badgesOf(b)!.label }}</span>
                    <span v-if="badgesOf(b)!.type" class="place__badge">{{ badgesOf(b)!.type }}</span>
                  </div>
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
                <p v-if="b.address ?? tagOf(b)" class="place__meta"><FilledIcon name="pin" :size="16" />{{ b.address ?? tagOf(b) }}</p>
                <p v-if="walkTime(b)" class="place__meta"><FilledIcon name="runner" :size="16" />{{ walkTime(b) }}</p>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </Transition>

    <!-- a place page over the list (child routes): it scrolls by itself, the list keeps its scroll under it
         and shows through when the page is swiped away (useSwipeBack) -->
    <RouterView v-slot="{ Component, route: over }">
      <Transition name="over">
        <div v-if="Component" :key="over.path" class="loc__over">
          <component :is="Component" />
        </div>
      </Transition>
    </RouterView>
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
    // the active tab is black in both modes (the swipe mockup тиндер.png, owner 2026-10-27)
    &.on {
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
  background: #000;
  transition: transform 0.38s cubic-bezier(0.34, 1.2, 0.5, 1);
  .seg--swipe & {
    transform: translateX(100%);
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
// mockup Location_Gallery: a coloured kind and a white type, top left on the photo
.place__badges {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 56px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.place__badge {
  padding: 1px 8px;
  border-radius: 6px;
  background: #fff;
  color: #000;
  font-size: 13px;
  line-height: 18px;
  &--fun {
    background: #f9b7fd;
  }
  &--nature {
    background: #c5df4f;
  }
  &--history {
    background: #ffe27e;
  }
  &--food {
    background: #ff9447;
    color: #fff;
  }
  &--hotel {
    background: #8d5ec8;
    color: #fff;
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

// a place page over the list: full screen, its own scroll; transparent itself, so the list shows through
// where the page is swiped away. Under the tab bar (z 20) like every page
.loc__over {
  position: fixed;
  inset: 0;
  z-index: 15;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  > :deep(main) {
    min-height: 100%;
  }
}
// opened: slides in from the right like an iOS page; closed by the back button: slides out
.over-enter-active {
  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.over-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 1, 1);
}
.over-enter-from,
.over-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .over-enter-active,
  .over-leave-active {
    transition-duration: 0.01s;
  }
}
</style>
