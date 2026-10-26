<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useMapStore } from '@/stores/map'
import type { MapBuilding, Rarity } from '@/types/game'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { usePlaces, walkTime } from './places'

const props = defineProps<{ id: string }>()

const router = useRouter()
const map = useMapStore()
const { buildings, loading, error, load, loadAll, distance, photo, isFavorite, favBusy, toggleFavorite } = usePlaces()

const RARITY: Record<Rarity, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' }

/** the map store already holds the building when coming from the list, so the page renders at once */
const building = computed<MapBuilding | null>(
  () => buildings.value.find((b) => b.id === props.id) ?? map.buildings.get(props.id) ?? null,
)

const NEARBY_LIMIT = 10
const nearby = computed(() => {
  const here = building.value
  if (!here) return []
  return buildings.value
    .filter((b) => b.id !== here.id)
    .map((b) => ({ building: b, meters: distanceMeters(here, b) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, NEARBY_LIMIT)
})

const expanded = ref(false)
/** six lines of .ld__text (line-height 20px), as the mockup's paragraph */
const COLLAPSED_PX = 120
const textEl = ref<HTMLElement | null>(null)
/** the full height of the description, measured; the button shows only when it is taller than six lines */
const fullHeight = ref(0)
const overflowing = computed(() => fullHeight.value > COLLAPSED_PX + 2)

function measure(): void {
  fullHeight.value = textEl.value?.scrollHeight ?? 0
}
watch(
  () => building.value?.description,
  () => void nextTick(measure),
  { immediate: true },
)
// the text reflows with the width and once the web font arrives
onMounted(() => {
  window.addEventListener('resize', measure)
  void document.fonts?.ready.then(measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))

watch(
  () => props.id,
  () => {
    expanded.value = false
    window.scrollTo({ top: 0 })
  },
)

function back(): void {
  if (window.history.state?.back) router.back()
  else void router.push('/locations')
}

const canShare = typeof navigator !== 'undefined' && (!!navigator.share || !!navigator.clipboard)
const copied = ref(false)
async function share(b: MapBuilding): Promise<void> {
  const url = window.location.href
  try {
    if (navigator.share) await navigator.share({ title: b.name, url })
    else {
      await navigator.clipboard.writeText(url)
      copied.value = true
      setTimeout(() => (copied.value = false), 2000)
    }
  } catch {
    // cancelled by the user or not allowed: nothing to report
  }
}

function openOnMap(b: MapBuilding): void {
  map.select(b.id)
  void router.push('/map')
}

onMounted(loadAll)
</script>

<template>
  <main class="ld">
    <template v-if="building">
      <div class="ld__hero">
        <img v-if="photo(building)" :src="photo(building)!" alt="" />
        <button class="ld__round ld__back" aria-label="Назад" @click="back"><AppIcon name="back" :size="22" /></button>
        <div class="ld__actions">
          <button
            v-if="building.discoveredAt"
            class="ld__round ld__round--glass ld__fav"
            :class="{ on: isFavorite(building) }"
            :aria-pressed="isFavorite(building)"
            :aria-label="isFavorite(building) ? 'Убрать из избранного' : 'В избранное'"
            :disabled="favBusy === building.id"
            @click="toggleFavorite(building)"
          >
            <AppIcon name="heart" :size="20" />
          </button>
          <button v-if="canShare" class="ld__round ld__round--glass" :aria-label="copied ? 'Ссылка скопирована' : 'Поделиться'" @click="share(building)">
            <svg v-if="!copied" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="m15.5 8.5-6.4 6.4a1.9 1.9 0 0 0 2.7 2.7l7-7a3.8 3.8 0 0 0-5.4-5.4l-7 7a5.7 5.7 0 0 0 8 8l5.2-5.2" />
            </svg>
            <AppIcon v-else name="check" :size="20" />
          </button>
        </div>
      </div>

      <article class="ld__sheet">
        <div class="ld__grip" aria-hidden="true" />
        <div class="ld__tags">
          <span class="ld__tag" :class="`r-${building.rarity}`">{{ RARITY[building.rarity] }}</span>
        </div>
        <h1 class="ld__name">{{ building.name }}</h1>
        <p v-if="building.address" class="ld__meta"><FilledIcon name="pin" :size="18" />{{ building.address }}</p>
        <p v-if="walkTime(distance(building))" class="ld__meta"><FilledIcon name="runner" :size="18" />{{ walkTime(distance(building)) }}</p>

        <div v-if="building.description" class="ld__about">
          <p
            ref="textEl"
            class="ld__text"
            :class="{ 'ld__text--clamped': overflowing && !expanded }"
            :style="overflowing ? { maxHeight: `${expanded ? fullHeight : COLLAPSED_PX}px` } : undefined"
          >{{ building.description }}</p>
          <button v-if="overflowing" class="ld__more" :aria-expanded="expanded" @click="expanded = !expanded">
            {{ expanded ? 'Свернуть' : 'Читать больше' }}
          </button>
        </div>

        <ul class="ld__rewards" aria-label="Награды за открытие">
          <li class="reward">
            <span class="reward__icon reward__icon--blue">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <circle cx="12" cy="9" r="5.5" /><circle cx="12" cy="9" r="2" /><path d="M9 14v7l3-2 3 2v-7" stroke-linejoin="round" />
              </svg>
            </span>
            <div>
              <p class="reward__title">Артефакт</p>
              <p class="reward__text">{{ building.discoveredAt ? 'Карточка уже в коллекции' : 'Карточка в коллекцию' }}</p>
            </div>
          </li>
          <li class="reward">
            <span class="reward__icon reward__icon--yellow"><CoinIcon :size="24" /></span>
            <div>
              <p class="reward__title">Монеты</p>
              <p class="reward__text">+{{ building.reward.coins }} монет</p>
            </div>
          </li>
          <li class="reward">
            <span class="reward__icon reward__icon--pink">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 9.2c1.4 1.3 4.1 2 7 2s5.6-.7 7-2V12c0 1.7-3.1 3-7 3s-7-1.3-7-3V9.2Zm0 5.8c1.4 1.3 4.1 2 7 2s5.6-.7 7-2v3c0 1.7-3.1 3-7 3s-7-1.3-7-3v-3Z" />
              </svg>
            </span>
            <div>
              <p class="reward__title">Очки</p>
              <p class="reward__text">+{{ building.reward.xp }} опыта в профиль</p>
            </div>
          </li>
        </ul>

        <section v-if="nearby.length" class="ld__nearby">
          <div class="ld__row">
            <h2>Что рядом</h2>
            <button class="ld__chev" aria-label="Показать на карте" @click="openOnMap(building)"><AppIcon name="chevron" :size="18" /></button>
          </div>
          <ul class="near">
            <li v-for="n in nearby" :key="n.building.id">
              <RouterLink :to="{ name: 'location', params: { id: n.building.id } }" class="near__card">
                <span class="near__photo">
                  <img v-if="photo(n.building)" :src="photo(n.building)!" alt="" />
                </span>
                <span class="near__name">{{ n.building.name }}</span>
                <span class="near__meta"><FilledIcon name="pin" :size="16" />{{ formatDistance(n.meters) }}</span>
              </RouterLink>
            </li>
          </ul>
        </section>

        <div class="ld__cta">
          <button class="ld__primary" @click="openOnMap(building)">Показать на карте</button>
          <RouterLink v-if="!building.discoveredAt" :to="`/scan/${building.id}`" class="ld__scan" aria-label="Сканировать здание">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16M4 12h16" />
            </svg>
          </RouterLink>
        </div>
      </article>
    </template>

    <div v-else class="ld__state">
      <button class="ld__round ld__back ld__back--plain" aria-label="Назад" @click="back"><AppIcon name="back" :size="22" /></button>
      <StateBlock v-if="loading" kind="loading" title="Загружаем место…" />
      <StateBlock
        v-else-if="error"
        kind="error"
        :title="error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
        action-label="Повторить"
        @action="load()"
      />
      <StateBlock v-else kind="empty" title="Место не найдено" text="Возможно, оно больше не участвует в игре." />
    </div>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (Страница локации.png, 4x)
$card: #f3f3f9;
$blue: #0189ff;

.ld {
  min-height: 100%;
  background: #fff;
}

.ld__hero {
  position: relative;
  height: calc(var(--safe-top) + 280px);
  overflow: hidden;
  background: #d5d1d1;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.ld__round {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #000;
  &--glass {
    background: rgb(255 255 255 / 45%);
    color: #fff;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
}
.ld__back {
  position: absolute;
  top: calc(var(--safe-top) + 56px);
  left: 16px;
  &--plain {
    position: static;
    background: $card;
    margin-bottom: 24px;
  }
}
.ld__actions {
  position: absolute;
  top: calc(var(--safe-top) + 56px);
  right: 16px;
  display: flex;
  gap: 8px;
}
.ld__fav.on {
  color: #ff3b6b;
  background: #fff;
  :deep(path) {
    fill: currentColor;
  }
}
.ld__sheet {
  position: relative;
  margin-top: -20px;
  padding: 8px 16px calc(var(--nav-height) + var(--safe-bottom) + 24px);
  border-radius: 20px 20px 0 0;
  background: #fff;
}
.ld__grip {
  width: 36px;
  height: 4px;
  margin: 0 auto 22px;
  border-radius: 2px;
  background: #d9d9de;
}
.ld__tags {
  display: flex;
  gap: 4px;
}
.ld__tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 15px;
  color: #000;
  background: #ffe27e;
  &.r-common {
    background: #ebebeb;
  }
  &.r-rare {
    background: #cfe6ff;
  }
  &.r-epic {
    background: #f9b7fd;
  }
}
.ld__name {
  margin: 14px 0 10px;
  font-size: 26px;
  font-weight: 600;
  line-height: 30px;
  color: #000;
}
.ld__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 14px;
  line-height: 18px;
  color: #85858c;
  svg {
    flex: none;
    color: $blue;
  }
}
.ld__about {
  margin-top: 18px;
}
.ld__text {
  font-size: 15px;
  line-height: 20px;
  color: #000;
  white-space: pre-line;
  overflow: hidden;
  // opens and closes smoothly: max-height goes between six lines and the measured full height
  transition: max-height 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  &--clamped {
    // the last visible line fades out instead of being cut
    mask-image: linear-gradient(#000 calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(#000 calc(100% - 20px), transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ld__text {
    transition: none;
  }
}
.ld__more {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: $blue;
  font-size: 16px;
  font-weight: 500;
}

.ld__rewards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}
.reward {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px;
  border-radius: 10px;
  background: #f9f9fc;
}
.reward__icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  &--blue {
    background: $blue;
    color: #fff;
  }
  &--yellow {
    background: #ffe27e;
  }
  &--pink {
    background: #fbdcfd;
    color: #000;
  }
}
.reward__title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  color: #000;
}
.reward__text {
  font-size: 14px;
  line-height: 18px;
  color: #8e8e93;
}

.ld__nearby {
  margin-top: 40px;
}
.ld__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  h2 {
    font-size: 22px;
    font-weight: 600;
    line-height: 28px;
    color: #000;
  }
}
.ld__chev {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: $card;
  color: #000;
}
.near {
  display: flex;
  gap: 8px;
  margin: 0 -16px 0 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  li {
    flex: 0 0 min(340px, 85%);
    scroll-snap-align: start;
  }
}
.near__card {
  display: flex;
  flex-direction: column;
  padding: 8px 8px 14px;
  border-radius: 12px;
  background: $card;
  color: inherit;
  text-decoration: none;
}
.near__photo {
  height: 180px;
  border-radius: 8px;
  overflow: hidden;
  background: #d5d1d1;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.near__name {
  margin: 14px 4px 4px;
  font-size: 17px;
  font-weight: 500;
  color: #000;
}
.near__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 4px;
  font-size: 13px;
  color: #85858c;
  svg {
    color: $blue;
  }
}

.ld__cta {
  position: sticky;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 12px);
  z-index: 20;
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.ld__primary {
  flex: 1;
  height: 48px;
  border: 0;
  border-radius: 14px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
}
.ld__scan {
  flex: none;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: $card;
  color: #000;
}

.ld__state {
  padding: calc(var(--safe-top) + 20px) 16px calc(var(--nav-height) + var(--safe-bottom) + 24px);
}
</style>
