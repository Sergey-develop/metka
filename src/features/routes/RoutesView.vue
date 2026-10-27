<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stackedName } from '@/app/pageStack'
import { useSwipeBack } from '@/features/locations/swipeBack'
import AppIcon from '@/components/ui/AppIcon.vue'
import CategoryChips from '@/components/ui/CategoryChips.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import { PLACE_ZONES, type AreaPlace } from '@/types/game'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { placePhoto, routePhoto } from './photos'
import { doneCount, hasPoint, ofKind, PLACE_CHIPS, placeTarget, ZONE_TITLE, type PlaceKind } from './routes'

/**
 * Zavidovo (content plan of 2026-10-27): quest routes, the base of places by zone and the artifact
 * collections (area_quests, migration 026).
 */
const router = useRouter()
/** the map this page lies over: routes and places opened from here lie over it too */
const here = useRoute()
/** swipe right: back to the map */
const swipeBack = useSwipeBack('/map')
const quests = useAreaQuestsStore()
const map = useMapStore()
const route = useRouteStore()

type Tab = 'routes' | 'places' | 'artifacts'
const tab = ref<Tab>('routes')
const TABS: { id: Tab; label: string }[] = [
  { id: 'routes', label: 'Маршруты' },
  { id: 'places', label: 'Места' },
  { id: 'artifacts', label: 'Артефакты' },
]

const category = ref<PlaceKind | null>(null)
const zones = computed(() =>
  PLACE_ZONES.map((zone) => ({
    zone,
    places: (quests.data?.places ?? []).filter((p) => p.zone === zone && ofKind(p, category.value)),
  })).filter(
    (z) => z.places.length > 0,
  ),
)
/** demo step «ближайшая метка»: the closest places not visited yet, when the player is near Zavidovo */
const NEARBY_MAX_M = 3000
const nearby = computed(() => {
  const at = map.position
  if (!at) return []
  return (quests.data?.places ?? [])
    .filter((p) => hasPoint(p) && !quests.visited.has(p.id) && ofKind(p, category.value))
    .map((p) => ({ place: p, meters: distanceMeters(at, p as AreaPlace & { lat: number; lng: number }) }))
    .filter((x) => x.meters <= NEARBY_MAX_M)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 3)
})

const earned = computed(() => (quests.data?.collections ?? []).flatMap((c) => c.items).filter((i) => i.earnedAt).length)
const artifactsTotal = computed(() => (quests.data?.collections ?? []).reduce((n, c) => n + c.items.length, 0))

function distance(p: AreaPlace): string | null {
  if (!map.position || !hasPoint(p)) return null
  return formatDistance(distanceMeters(map.position, p))
}

function walkTo(p: AreaPlace): void {
  if (!hasPoint(p)) return
  map.select(null)
  route.start(placeTarget(p), '/routes')
  void router.push('/map')
}

onMounted(() => void quests.load())
</script>

<template>
  <main class="page zr" v-on="swipeBack.handlers">
    <header class="zr__head">
      <button class="zr__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1>Завидово</h1>
    </header>

    <div class="zr__tabs" role="tablist" aria-label="Разделы">
      <button v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">
        {{ t.label }}
      </button>
    </div>

    <StateBlock
      v-if="quests.error && !quests.data"
      kind="error"
      :title="quests.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="quests.load(true)"
    />
    <StateBlock v-else-if="!quests.data" kind="loading" title="Загружаем Завидово…" />

    <template v-else-if="tab === 'routes'">
      <RouterLink :to="{ name: 'random-route' }" class="rc rc--random">
        <span class="rc__title">Случайное Завидово</span>
        <span class="rc__text">Ответь на четыре вопроса — подберём прогулку под настроение.</span>
      </RouterLink>
      <ul class="zr__list">
        <li v-for="r in quests.data.routes" :key="r.id">
          <RouterLink :to="{ name: stackedName(here, 'route'), params: { slug: r.slug } }" class="rc" :class="{ 'rc--done': r.completedAt }">
            <img v-if="routePhoto(r)" class="rc__cover" :src="routePhoto(r)!" alt="" loading="lazy" />
            <span class="rc__top">
              <span class="rc__time"><FilledIcon name="runner" :size="16" />{{ r.duration }}</span>
              <span v-if="r.completedAt" class="rc__badge">Пройден</span>
              <span v-else-if="doneCount(r) > 0" class="rc__badge rc__badge--go">{{ doneCount(r) }}/{{ r.steps.length }}</span>
            </span>
            <span class="rc__title">{{ r.title }}</span>
            <span class="rc__quest">Квест «{{ r.questTitle }}»</span>
            <span class="rc__text">{{ r.description }}</span>
            <span class="rc__chips">
              <span v-for="c in r.categories" :key="c" class="rc__chip">{{ c }}</span>
            </span>
            <span class="rc__bar" aria-hidden="true"><span :style="{ width: `${(doneCount(r) / Math.max(r.steps.length, 1)) * 100}%` }" /></span>
          </RouterLink>
        </li>
      </ul>
    </template>

    <template v-else-if="tab === 'places'">
      <CategoryChips v-model="category" class="zr__cats" :items="PLACE_CHIPS" />
      <StateBlock v-if="zones.length === 0" kind="empty" title="Таких мест пока нет" />
      <section v-if="nearby.length" class="zr__zone">
        <h2>Рядом с тобой</h2>
        <ul class="pl">
          <li v-for="n in nearby" :key="n.place.id" class="pl__item pl__item--near">
            <RouterLink :to="{ name: stackedName(here, 'place'), params: { id: n.place.id } }" class="pl__body">
              <p class="pl__name">{{ n.place.name }}</p>
              <p class="pl__meta"><span>{{ formatDistance(n.meters) }}</span><span>+{{ n.place.rewardXp }} опыта за отметку</span></p>
            </RouterLink>
          </li>
        </ul>
      </section>
      <section v-for="z in zones" :key="z.zone" class="zr__zone">
        <h2>{{ ZONE_TITLE[z.zone] }}</h2>
        <ul class="pl">
          <li v-for="p in z.places" :key="p.id" class="pl__item">
            <img v-if="placePhoto(p)" class="pl__photo" :src="placePhoto(p)!" alt="" loading="lazy" />
            <RouterLink :to="{ name: stackedName(here, 'place'), params: { id: p.id } }" class="pl__body">
              <p class="pl__name">{{ p.name }}<span v-if="quests.visited.has(p.id)" class="pl__visited" aria-label="отмечено"> ✓</span></p>
              <p class="pl__meta">
                <span>{{ p.category }}</span>
                <span v-if="p.isPartner" class="pl__tag pl__tag--partner">Партнёр</span>
                <span v-if="!hasPoint(p)" class="pl__tag">Точка уточняется</span>
                <span v-else-if="p.needsCheck" class="pl__tag">Примерно</span>
              </p>
              <p class="pl__text">{{ p.description }}</p>
              <p v-if="p.openingHours" class="pl__idea">{{ p.openingHours }}</p>
            </RouterLink>
            <button v-if="hasPoint(p)" class="pl__go" :aria-label="`${p.name}: как дойти`" @click="walkTo(p)">
              <FilledIcon name="pin" :size="16" />{{ distance(p) ?? 'Как дойти' }}
            </button>
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
      <p class="zr__count">Собрано {{ earned }} из {{ artifactsTotal }}</p>
      <section v-for="c in quests.data.collections" :key="c.id" class="ac">
        <div class="ac__head">
          <h2>{{ c.title }}</h2>
          <span>{{ c.items.filter((i) => i.earnedAt).length }}/{{ c.items.length }}</span>
        </div>
        <ul class="ac__items">
          <li v-for="a in c.items" :key="a.id" class="ac__item" :class="{ on: a.earnedAt }">
            <span class="ac__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="9" r="5.5" /><circle cx="12" cy="9" r="2" /><path d="M9 14v7l3-2 3 2v-7" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="ac__text">
              <span class="ac__title">{{ a.title }}</span>
              <span class="ac__how">{{ a.earnedAt ? 'Получен' : a.how }}</span>
            </span>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped lang="scss">
$blue: #0189ff;
$card: #f3f3f9;

.zr {
  // swiped right back to the map (useSwipeBack); vertical scrolling stays the browser's
  touch-action: pan-y;
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.zr__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  margin: 8px 0 16px;
  h1 {
    font-size: 17px;
    font-weight: 600;
    color: #000;
  }
}
.zr__back {
  position: absolute;
  left: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #eeeef0;
  color: #000;
}
.zr__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 20px;
  border-radius: 10px;
  background: $card;
  button {
    flex: 1;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #8e8e93;
    font-size: 14px;
    font-weight: 500;
    &.on {
      background: #fff;
      color: #000;
      box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
    }
  }
}
.zr__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  // a list: no browser indent and bullets
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  overflow: hidden;
  border-radius: 14px;
  background: $card;
  color: #000;
  text-decoration: none;
  &--done {
    background: #e8f4ff;
  }
  &--random {
    margin-bottom: 12px;
    background: linear-gradient(135deg, #0189ff, #6ec1ff);
    color: #fff;
    .rc__text {
      color: #fff;
    }
  }
}
.rc__cover {
  display: block;
  width: calc(100% + 32px);
  height: 160px;
  margin: -16px -16px 6px;
  border-radius: 14px 14px 0 0;
  object-fit: cover;
}
.rc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rc__time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #8e8e93;
}
.rc__badge {
  padding: 2px 8px;
  border-radius: 6px;
  background: $blue;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  &--go {
    background: #fff;
    color: $blue;
  }
}
.rc__title {
  font-size: 18px;
  font-weight: 600;
}
.rc__quest {
  font-size: 14px;
  color: $blue;
}
.rc__text {
  font-size: 14px;
  line-height: 19px;
  color: #3c3c43;
}
.rc__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rc__chip {
  padding: 3px 8px;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #3c3c43;
}
.rc__bar {
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  background: #dcdce4;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    background: $blue;
  }
}

.zr__zone {
  margin-bottom: 24px;
  h2 {
    margin-bottom: 10px;
    font-size: 20px;
    font-weight: 600;
  }
}
.pl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pl__item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px;
  border-radius: 12px;
  background: $card;
}
.pl__item--near {
  background: #eaf4ff;
}
.pl__visited {
  color: $blue;
}
.pl__photo {
  flex: none;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
}
.pl__body {
  flex: 1;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.zr__cats {
  margin-bottom: 16px;
}
.pl__name {
  font-size: 16px;
  font-weight: 500;
  color: #000;
}
.pl__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 2px;
  font-size: 13px;
  color: #8e8e93;
}
.pl__tag {
  padding: 1px 6px;
  border-radius: 5px;
  background: #fff;
  font-size: 11px;
  color: #8e8e93;
  &--partner {
    background: #ffe27e;
    color: #000;
  }
}
.pl__text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 18px;
  color: #3c3c43;
}
.pl__idea {
  margin-top: 4px;
  font-size: 12px;
  color: $blue;
}
.pl__go {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: #fff;
  color: $blue;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.zr__count {
  margin-bottom: 12px;
  font-size: 14px;
  color: #8e8e93;
}
.ac {
  margin-bottom: 20px;
}
.ac__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  h2 {
    font-size: 20px;
    font-weight: 600;
  }
  span {
    font-size: 14px;
    color: #8e8e93;
  }
}
.ac__items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ac__item {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f9f9fc;
  &.on .ac__icon {
    background: $blue;
    color: #fff;
  }
}
.ac__icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #e5e5ea;
  color: #b9babc;
}
.ac__text {
  display: flex;
  flex-direction: column;
}
.ac__title {
  font-size: 15px;
  font-weight: 500;
  color: #000;
}
.ac__how {
  font-size: 13px;
  color: #8e8e93;
}
</style>
