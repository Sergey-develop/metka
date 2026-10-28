<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stackedName } from '@/app/pageStack'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { services } from '@/app/providers/services'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import { useAreaQuestsStore, type StepOutcome } from '@/stores/areaQuests'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { message, rewardLines } from './outcome'
import { photoCredit, placePhoto } from './photos'
import { doneCount, hasPoint, placeBadges, placeTarget } from './routes'
import { useSwipeBack } from '@/features/locations/swipeBack'

/** A place of Zavidovo (area_places): photo, what it is, contacts, the way there and the routes through it. */
const props = defineProps<{ id: string }>()
/** swipe right: back to the list of all locations */
const swipeBack = useSwipeBack()
const router = useRouter()
/** the page this one lies over (the map or the locations list), for links that stay in it */
const here = useRoute()
const quests = useAreaQuestsStore()
const map = useMapStore()
const walk = useRouteStore()

const place = computed(() => quests.data?.places.find((p) => p.id === props.id) ?? null)
/** its tag and type, the same badges as on its card */
const badges = computed(() => (place.value ? placeBadges(place.value) : null))
const routes = computed(() => quests.routes.filter((r) => r.steps.some((s) => s.place?.id === props.id)))
const distance = computed(() =>
  map.position && place.value && hasPoint(place.value) ? formatDistance(distanceMeters(map.position, place.value)) : null,
)
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

const visited = computed(() => quests.visited.has(props.id))
const outcome = ref<StepOutcome | null>(null)
async function checkIn(): Promise<void> {
  if (!place.value) return
  const result = await quests.checkIn(place.value)
  if (result) outcome.value = result
}

/** dev with mocks only: puts the mock GPS at the place */
const devTools = services().devTools
function teleport(): void {
  const p = place.value
  if (devTools && p && hasPoint(p)) devTools.teleport(p.lat, p.lng)
}

function walkTo(): void {
  const p = place.value
  if (!p || !hasPoint(p)) return
  map.select(null)
  walk.start(placeTarget(p), `/places/${p.id}`)
  void router.push('/map')
}

onMounted(() => void quests.load())
</script>

<template>
  <main class="page pd" v-on="swipeBack.handlers">
    <header class="pd__head">
      <button class="pd__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1>Место</h1>
    </header>

    <StateBlock
      v-if="quests.error && !quests.data"
      kind="error"
      :title="quests.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="quests.load(true)"
    />
    <StateBlock v-else-if="!quests.data" kind="loading" title="Загружаем место…" />
    <StateBlock v-else-if="!place" kind="empty" title="Место не найдено" action-label="Все места" @action="router.replace('/routes')" />

    <template v-else>
      <figure v-if="placePhoto(place)" class="pd__figure">
        <img class="pd__cover" :src="placePhoto(place)!" alt="" />
        <figcaption v-if="photoCredit(place)" class="pd__credit">
          <template v-if="photoCredit(place)!.example">Фото для примера · </template>
          <a :href="photoCredit(place)!.url" target="_blank" rel="noopener noreferrer">{{ photoCredit(place)!.author }}</a>, {{ photoCredit(place)!.license }}
        </figcaption>
      </figure>
      <p class="pd__tags">
        <span class="pd__tag" :class="`pd__tag--${badges!.kind}`">{{ badges!.label }}</span>
        <span v-if="badges!.type" class="pd__tag">{{ badges!.type }}</span>
        <span v-if="place.isPartner" class="pd__tag pd__tag--partner">Партнёр</span>
      </p>
      <h2 class="pd__name">{{ place.name }}</h2>
      <p class="pd__meta">{{ place.category }}<template v-if="distance"> · {{ distance }}</template></p>
      <p class="pd__text">{{ place.description }}</p>
      <p v-if="place.needsCheck" class="pd__check">Точка на карте примерная — уточняется на месте.</p>


      <dl class="pd__info">
        <template v-if="place.address">
          <dt>Адрес</dt>
          <dd>{{ place.address }}</dd>
        </template>
        <template v-if="place.openingHours">
          <dt>Часы работы</dt>
          <dd>{{ place.openingHours }}</dd>
        </template>
        <template v-if="place.phone">
          <dt>Телефон</dt>
          <dd><a :href="tel(place.phone)">{{ place.phone }}</a></dd>
        </template>
        <template v-if="place.website">
          <dt>Сайт</dt>
          <dd><a :href="place.website" target="_blank" rel="noopener noreferrer">{{ place.website.replace(/^https?:\/\//, '').replace(/\/$/, '') }}</a></dd>
        </template>
        <template v-if="place.idea">
          <dt>В игре</dt>
          <dd>{{ place.idea }}</dd>
        </template>
      </dl>

      <section v-if="hasPoint(place)" class="pd__task" :class="{ 'pd__task--done': visited }">
        <p class="pd__task-title">{{ visited ? 'Ты здесь отметился' : place.isPartner ? 'Задание партнёра' : 'Самостоятельное задание' }}</p>
        <p class="pd__task-text">
          {{ visited ? 'Награда получена.' : 'Приди сюда и отметься.' }}
          <template v-if="!visited">
            Награда: +{{ place.rewardXp }} опыта<template v-if="place.rewardCoins"> · <CoinIcon :size="14" /> {{ place.rewardCoins }}</template>
          </template>
        </p>
        <button v-if="!visited" class="pd__primary pd__primary--inline" :disabled="quests.busyPlace !== null" @click="checkIn">
          {{ quests.busyPlace === place.id ? 'Проверяем…' : 'Отметиться здесь' }}
        </button>
        <button v-if="devTools && !visited" class="pd__dev" @click="teleport">Переместиться к месту (dev)</button>
        <p v-if="outcome" class="pd__result" :class="{ 'pd__result--ok': outcome.kind === 'done' }" role="status">
          {{ outcome.kind === 'done' && outcome.xp > 0 ? 'Отметка засчитана!' : message(outcome) }}
          <template v-for="line in rewardLines(outcome)" :key="line"><br />{{ line }}</template>
        </p>
      </section>

      <!-- the quests through this place: the card starts one (the demo's «запускаем квест») -->
      <section v-if="routes.length" class="pd__routes">
        <h3>{{ routes.length > 1 ? 'Квесты здесь' : 'Квест здесь' }}</h3>
        <RouterLink v-for="r in routes" :key="r.id" :to="{ name: stackedName(here, 'route'), params: { slug: r.slug } }" class="pd__route">
          <span class="pd__route-text">
            <b>{{ r.questTitle }}</b>
            <small>{{ r.title }} · {{ doneCount(r) }}/{{ r.steps.length }}</small>
          </span>
          <span class="pd__route-go" :class="{ 'pd__route-go--done': r.completedAt }">
            {{ r.completedAt ? 'Пройден' : doneCount(r) > 0 ? 'Продолжить' : 'Начать квест' }}
          </span>
        </RouterLink>
      </section>

      <!-- the actions, side by side at the end of the page -->
      <div v-if="(badges?.kind === 'food' && place.phone) || hasPoint(place)" class="pd__cta">
        <!-- a restaurant with a phone: «Забронировать» calls it -->
        <a v-if="badges?.kind === 'food' && place.phone" class="pd__primary pd__book" :href="tel(place.phone)">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z"
            />
          </svg>
          Забронировать
        </a>
        <button v-if="hasPoint(place)" class="pd__primary" :class="{ 'pd__primary--soft': badges?.kind === 'food' && place.phone }" @click="walkTo">
          <FilledIcon name="pin" :size="20" />Как дойти
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped lang="scss">
$blue: #0189ff;
$card: #f3f3f9;

.pd {
  // swiped right back to the locations list (useSwipeBack); vertical scrolling stays the browser's
  touch-action: pan-y;
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.pd__head {
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
.pd__back {
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
.pd__figure {
  margin: 0 0 14px;
}
.pd__credit {
  margin-top: 4px;
  font-size: 11px;
  color: #8e8e93;
  a {
    color: inherit;
  }
}
.pd__cover {
  display: block;
  width: 100%;
  height: 220px;
  border-radius: 16px;
  object-fit: cover;
}
.pd__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pd__tag {
  padding: 3px 9px;
  border-radius: 6px;
  background: $card;
  font-size: 12px;
  font-weight: 500;
  color: #3c3c43;
  // the tag of the place (Теги.png), as on its card
  &--fun {
    background: #f9b7fd;
    color: #000;
  }
  &--nature {
    background: #c5df4f;
    color: #000;
  }
  &--history,
  &--partner {
    background: #ffe27e;
    color: #000;
  }
  &--sport {
    background: $blue;
    color: #fff;
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
.pd__name {
  margin-top: 10px;
  font-size: 24px;
  font-weight: 600;
  line-height: 28px;
  color: #000;
}
.pd__meta {
  margin-top: 4px;
  font-size: 14px;
  color: #8e8e93;
}
.pd__text {
  margin-top: 12px;
  font-size: 15px;
  line-height: 21px;
  color: #3c3c43;
}
.pd__check {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #fff6d6;
  font-size: 13px;
  color: #5c4a00;
}
.pd__info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  margin-top: 16px;
  padding: 14px;
  border-radius: 14px;
  background: $card;
  font-size: 14px;
  dt {
    color: #8e8e93;
  }
  dd {
    margin: 0;
    color: #000;
    overflow-wrap: anywhere;
  }
  a {
    color: $blue;
  }
  &:empty {
    display: none;
  }
}
.pd__task {
  margin-top: 16px;
  padding: 14px;
  border-radius: 14px;
  background: #eaf4ff;
  &--done {
    background: $card;
  }
}
.pd__task-title {
  font-size: 16px;
  font-weight: 600;
  color: #000;
}
.pd__task-text {
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
  color: #3c3c43;
}
.pd__primary--inline {
  margin-top: 12px;
  &:disabled {
    opacity: 0.5;
  }
}
.pd__dev {
  margin-top: 8px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: #8e8e93;
  font-size: 13px;
  text-decoration: underline;
}
.pd__result {
  margin-top: 10px;
  font-size: 14px;
  line-height: 19px;
  color: #b4441c;
  &--ok {
    color: #1a7f37;
  }
}
.pd__routes {
  margin-top: 20px;
  h3 {
    margin-bottom: 8px;
    font-size: 17px;
    font-weight: 600;
  }
}
.pd__route-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  b {
    font-weight: 600;
  }
  small {
    font-size: 13px;
    color: #8e8e93;
  }
}
.pd__route-go {
  flex: none;
  padding: 8px 12px;
  border-radius: 10px;
  background: $blue;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  &--done {
    background: #e3f6ec;
    color: #1a7f37;
  }
}
.pd__route {
  gap: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  margin-bottom: 6px;
  border-radius: 12px;
  background: $card;
  color: #000;
  font-size: 15px;
  text-decoration: none;
}
.pd__cta {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  .pd__primary {
    flex: 1;
    margin-top: 0;
  }
}
.pd__book {
  text-decoration: none;
}
// next to «Забронировать»: the second action is lighter
.pd__primary.pd__primary--soft {
  background: #dcecfc;
  color: $blue;
}
.pd__primary {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  border: 0;
  border-radius: 14px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
}
</style>
