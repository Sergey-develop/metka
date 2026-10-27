<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import { formatDistance } from '@/utils/geo'
import { gameAreaAt, ZAVIDOVO_HOME } from '@/utils/gameAreas'
import { placePhoto } from './photos'
import { pickWalk, type Company, type Minutes, type Mood, type RandomAnswers, type RandomWalk, type Reach } from './random'
import { placeTarget } from './routes'

/** «Случайное Завидово» (route № 4): four answers → a short walk through the places of the resort. */
const router = useRouter()
const quests = useAreaQuestsStore()
const map = useMapStore()
const walkRoute = useRouteStore()

const QUESTIONS = [
  { key: 'mood', title: 'Настроение', options: [['surprise', 'Удивиться'], ['relax', 'Отдохнуть'], ['move', 'Подвигаться']] },
  { key: 'minutes', title: 'Время', options: [[20, '20 минут'], [30, '30 минут'], [45, '45 минут']] },
  { key: 'company', title: 'С кем', options: [['alone', 'Один'], ['pair', 'Вдвоём'], ['kids', 'С детьми'], ['friends', 'Компанией']] },
  { key: 'reach', title: 'Дистанция', options: [['near', 'Рядом'], ['resort', 'Весь курорт']] },
] as const

const answers = reactive<RandomAnswers>({ mood: 'surprise', minutes: 30, company: 'pair', reach: 'near' })
function choose(key: keyof RandomAnswers, value: Mood | Minutes | Company | Reach): void {
  ;(answers as Record<keyof RandomAnswers, unknown>)[key] = value
}

/** from the player when they are in Zavidovo, otherwise from the main bay */
const start = computed(() => (map.position && gameAreaAt(map.position) === 'zavidovo' ? map.position : ZAVIDOVO_HOME))
const fromBay = computed(() => start.value === ZAVIDOVO_HOME)

const walk = ref<RandomWalk | null>(null)
function build(): void {
  walk.value = pickWalk(quests.data?.places ?? [], { ...answers }, start.value, quests.visited)
}

function go(): void {
  const first = walk.value?.stops[0]
  if (!first) return
  map.select(null)
  walkRoute.start(placeTarget(first.place), `/places/${first.place.id}`)
  void router.push('/map')
}

onMounted(() => void quests.load())
</script>

<template>
  <main class="page rr">
    <header class="rr__head">
      <button class="rr__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1>Случайное Завидово</h1>
    </header>

    <StateBlock
      v-if="quests.error && !quests.data"
      kind="error"
      :title="quests.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="quests.load(true)"
    />
    <StateBlock v-else-if="!quests.data" kind="loading" title="Загружаем места…" />

    <template v-else>
      <p class="rr__lead">Ответь на четыре вопроса — подберём короткую прогулку по курорту.</p>
      <fieldset v-for="q in QUESTIONS" :key="q.key" class="rr__q">
        <legend>{{ q.title }}</legend>
        <div class="rr__opts">
          <button
            v-for="[value, label] in q.options"
            :key="String(value)"
            type="button"
            class="rr__opt"
            :class="{ on: answers[q.key] === value }"
            :aria-pressed="answers[q.key] === value"
            @click="choose(q.key, value)"
          >
            {{ label }}
          </button>
        </div>
      </fieldset>

      <button class="rr__primary" @click="build">{{ walk ? 'Другой вариант' : 'Подобрать прогулку' }}</button>

      <section v-if="walk" class="rr__walk" aria-live="polite">
        <StateBlock
          v-if="walk.stops.length === 0"
          kind="empty"
          title="Ничего не нашлось"
          text="Попробуй «Весь курорт» или другое настроение."
        />
        <template v-else>
          <p class="rr__sum">
            {{ walk.stops.length }} {{ walk.stops.length === 1 ? 'остановка' : walk.stops.length < 5 ? 'остановки' : 'остановок' }}
            · {{ formatDistance(walk.totalM) }} · ≈{{ Math.max(walk.minutes, 5) }} мин пешком
            <template v-if="fromBay"><br />Считаем от Главной бухты: тебя пока нет в Завидово.</template>
          </p>
          <ol class="rr__stops">
            <li v-for="(s, i) in walk.stops" :key="s.place.id">
              <RouterLink :to="{ name: 'place', params: { id: s.place.id } }" class="rr__stop">
                <span class="rr__num">{{ i + 1 }}</span>
                <img v-if="placePhoto(s.place)" class="rr__photo" :src="placePhoto(s.place)!" alt="" loading="lazy" />
                <span class="rr__text">
                  <span class="rr__name">{{ s.place.name }}</span>
                  <span class="rr__meta">{{ s.place.category }} · {{ formatDistance(s.legM) }}</span>
                </span>
              </RouterLink>
            </li>
          </ol>
          <button class="rr__primary rr__primary--go" @click="go"><FilledIcon name="pin" :size="20" />К первой остановке</button>
        </template>
      </section>
    </template>
  </main>
</template>

<style scoped lang="scss">
$blue: #0189ff;
$card: #f3f3f9;

.rr {
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.rr__head {
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
.rr__back {
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
.rr__lead {
  margin-bottom: 16px;
  font-size: 15px;
  line-height: 21px;
  color: #3c3c43;
}
.rr__q {
  margin: 0 0 14px;
  padding: 0;
  border: 0;
  legend {
    margin-bottom: 8px;
    font-size: 15px;
    font-weight: 600;
    color: #000;
  }
}
.rr__opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rr__opt {
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: $card;
  color: #3c3c43;
  font-size: 14px;
  &.on {
    background: $blue;
    color: #fff;
  }
}
.rr__primary {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
  border: 0;
  border-radius: 14px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  &--go {
    margin-top: 14px;
  }
}
.rr__walk {
  margin-top: 20px;
}
.rr__sum {
  margin-bottom: 10px;
  font-size: 14px;
  line-height: 20px;
  color: #8e8e93;
}
.rr__stops {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  list-style: none;
}
.rr__stop {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: $card;
  color: #000;
  text-decoration: none;
}
.rr__num {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: $blue;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.rr__photo {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
}
.rr__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rr__name {
  font-size: 15px;
  font-weight: 500;
}
.rr__meta {
  font-size: 13px;
  color: #8e8e93;
}
</style>
