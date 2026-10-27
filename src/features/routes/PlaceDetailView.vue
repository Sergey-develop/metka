<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
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
import { placePhoto } from './photos'
import { hasPoint, placeTarget, TAG_LABEL } from './routes'

/** A place of Zavidovo (area_places): photo, what it is, contacts, the way there and the routes through it. */
const props = defineProps<{ id: string }>()
const router = useRouter()
const quests = useAreaQuestsStore()
const map = useMapStore()
const walk = useRouteStore()

const place = computed(() => quests.data?.places.find((p) => p.id === props.id) ?? null)
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
  <main class="page pd">
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
      <img v-if="placePhoto(place)" class="pd__cover" :src="placePhoto(place)!" alt="" />
      <p class="pd__tags">
        <span v-for="t in place.tags" :key="t" class="pd__tag" :class="`pd__tag--${t}`">{{ TAG_LABEL[t] }}</span>
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

      <section v-if="routes.length" class="pd__routes">
        <h3>Есть в маршрутах</h3>
        <RouterLink v-for="r in routes" :key="r.id" :to="{ name: 'route', params: { slug: r.slug } }" class="pd__route">
          {{ r.title }}<AppIcon name="chevron" :size="18" />
        </RouterLink>
      </section>

      <button v-if="hasPoint(place)" class="pd__primary" @click="walkTo"><FilledIcon name="pin" :size="20" />Как дойти</button>
    </template>
  </main>
</template>

<style scoped lang="scss">
$blue: #0189ff;
$card: #f3f3f9;

.pd {
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
.pd__cover {
  display: block;
  width: 100%;
  height: 220px;
  margin-bottom: 14px;
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
  &--sport {
    background: $blue;
    color: #fff;
  }
  &--culture {
    background: #f9b7fd;
  }
  &--kids {
    background: #fdf0cf;
  }
  &--free {
    background: #fdcfcd;
  }
  &--food,
  &--partner {
    background: #ffe27e;
  }
  &--rest {
    background: #c9f0dc;
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
.pd__route {
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
