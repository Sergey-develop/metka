<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import buildingArt from '@/assets/tasks/building.webp'
import cityArt from '@/assets/tasks/city.webp'
import mapArt from '@/assets/tasks/map.webp'
import shoeArt from '@/assets/tasks/shoe.webp'
import towerArt from '@/assets/tasks/tower.webp'
import { useTasksStore } from '@/stores/tasks'
import type { GameTask, TaskKind } from '@/types/game'
import { timeLeft } from './tasksText'

/**
 * Tasks of the day, of the week and the seasonal one — shared by the sheet on the map and the tasks
 * page. `sheet` draws them as the mockup «выдвигаются задания» (no timer, no bars, coins under the
 * title, a chevron that emits `more`); otherwise as the page mockup задания.png (timer, progress
 * bars). The tasks of the day look the same in both. Progress comes from the server (my_tasks);
 * a finished task shows «Забрать» for its coins. Illustrations are cut from the mockups.
 */
defineProps<{ sheet?: boolean }>()
const emit = defineEmits<{ more: [] }>()
const tasks = useTasksStore()

const ART: Record<TaskKind, string> = { discover: mapArt, cells: shoeArt, rare: buildingArt, memory: mapArt, districts: cityArt }
const done = (t: GameTask) => t.progress >= t.target
const dayDone = computed(() => tasks.day.filter(done).length)
const season = computed(() => tasks.state?.season ?? null)
const seasonEnds = computed(() =>
  season.value ? new Date(season.value.endsAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' }) : '',
)
const fmt = (n: number) => n.toLocaleString('ru-RU')
const ratio = (progress: number, target: number) => `${Math.min(1, progress / Math.max(1, target)) * 100}%`

// «12ч 25мин» to the reset of the day's tasks, refreshed every half minute
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
const resetIn = computed(() => (tasks.state ? timeLeft(Date.parse(tasks.state.dayEndsAt) - now.value) : ''))

onMounted(() => {
  void tasks.load()
  clock = setInterval(() => {
    now.value = Date.now()
    // the day is over: fetch the new day's tasks
    if (tasks.state && Date.parse(tasks.state.dayEndsAt) <= now.value && !tasks.loading) void tasks.load()
  }, 30_000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})
</script>

<template>
  <div class="board">
    <StateBlock v-if="tasks.loading && !tasks.state" kind="loading" />
    <StateBlock v-else-if="!tasks.state" kind="error" title="Не удалось загрузить задания" action-label="Повторить" @action="tasks.load()" />

    <template v-else>
      <p v-if="tasks.error" class="error" role="alert">
        {{ tasks.error.code === 'task_not_completed' ? 'Задание ещё не выполнено.' : 'Не удалось получить награду. Попробуйте ещё раз.' }}
      </p>

      <header class="head">
        <h2>Задания дня</h2>
        <span class="head__chips">
          <span v-if="!sheet" class="chip" :aria-label="`До новых заданий ${resetIn}`">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm.9 4.5a.9.9 0 0 0-1.8 0V12c0 .3.1.5.3.7l3 2.5a.9.9 0 1 0 1.2-1.4l-2.7-2.2V7.5Z" />
            </svg>
            {{ resetIn }}
          </span>
          <span class="chip" :class="{ 'chip--count': sheet }" :aria-label="`Выполнено ${dayDone} из ${tasks.day.length}`">{{ dayDone }}/{{ tasks.day.length }}</span>
        </span>
      </header>

      <ul class="day">
        <li v-for="t in tasks.day" :key="t.slug" class="task" :class="{ 'task--done': done(t) }">
          <h3 class="task__title">{{ t.title }}</h3>
          <p v-if="!done(t)" class="task__progress">{{ fmt(t.progress) }} / {{ fmt(t.target) }}</p>
          <div class="task__foot">
            <img class="task__art" :src="ART[t.kind]" alt="" />
            <button
              v-if="done(t) && !t.claimed"
              class="coin coin--claim"
              :disabled="tasks.claiming.has(t.slug)"
              :aria-label="`Забрать ${t.rewardCoins} монет`"
              @click="tasks.claim(t.slug)"
            >
              <CoinIcon :size="18" />Забрать
            </button>
            <span v-else class="coin"><CoinIcon :size="18" />+{{ t.rewardCoins }}</span>
            <span class="check" :class="{ 'check--on': done(t) }" :aria-label="done(t) ? 'Выполнено' : 'Не выполнено'">
              <svg v-if="done(t)" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5 10 17l9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </div>
        </li>
      </ul>

      <article v-for="t in tasks.week" :key="t.slug" class="big">
        <div class="big__text">
          <p class="big__kind"><FilledIcon name="calendar" :size="16" />Задание недели</p>
          <h3 class="big__title">{{ t.title }}</h3>
          <template v-if="!sheet">
            <p class="big__count">{{ t.claimed ? 'Награда получена' : `${fmt(t.progress)}/${fmt(t.target)}` }}</p>
            <span class="bar" role="progressbar" :aria-valuenow="t.progress" :aria-valuemax="t.target" :aria-label="t.title">
              <span :style="{ width: ratio(t.progress, t.target) }" />
            </span>
          </template>
          <span v-else class="big__reward">
            <button v-if="done(t) && !t.claimed" class="coin coin--claim" :disabled="tasks.claiming.has(t.slug)" @click="tasks.claim(t.slug)">
              <CoinIcon :size="18" />Забрать {{ t.rewardCoins }}
            </button>
            <span v-else class="coin coin--light"><CoinIcon :size="18" />+{{ t.rewardCoins }}</span>
          </span>
        </div>
        <div class="big__side">
          <img class="big__art" :src="ART[t.kind]" alt="" />
          <template v-if="!sheet">
            <button v-if="done(t) && !t.claimed" class="coin coin--claim" :disabled="tasks.claiming.has(t.slug)" @click="tasks.claim(t.slug)">
              <CoinIcon :size="18" />Забрать {{ t.rewardCoins }}
            </button>
            <span v-else class="coin coin--light"><CoinIcon :size="18" />+{{ t.rewardCoins }}</span>
          </template>
        </div>
        <button v-if="sheet" class="big__more" aria-label="Все задания" @click="emit('more')"><AppIcon name="chevron" :size="20" /></button>
      </article>

      <article v-if="season" class="big">
        <div class="big__text">
          <p class="big__kind">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 2 4 6v6c0 4.4 3.4 8.5 8 10 4.6-1.5 8-5.6 8-10V6l-8-4Zm2.6 6.3-1.5 4.6a1 1 0 0 1-.6.6l-4.6 1.5 1.5-4.6a1 1 0 0 1 .6-.6l4.6-1.5Z" />
            </svg>
            Сезонное задание · до {{ seasonEnds }}
          </p>
          <h3 class="big__title">{{ season.title }}</h3>
          <template v-if="!sheet">
            <p class="big__count">{{ season.claimed ? 'Награда получена' : `${fmt(season.progress)}/${fmt(season.target)}` }}</p>
            <span class="bar" role="progressbar" :aria-valuenow="season.progress" :aria-valuemax="season.target" :aria-label="season.title">
              <span :style="{ width: ratio(season.progress, season.target) }" />
            </span>
          </template>
          <span v-else class="big__reward">
            <button v-if="season.completed && !season.claimed" class="coin coin--claim" @click="tasks.claimSeason()">
              <CoinIcon :size="18" />Забрать {{ season.rewardCoins }}
            </button>
            <span v-else class="coin coin--light"><CoinIcon :size="18" />+{{ season.rewardCoins }}</span>
          </span>
        </div>
        <div class="big__side">
          <img class="big__art" :src="towerArt" alt="" />
          <template v-if="!sheet">
            <button v-if="season.completed && !season.claimed" class="coin coin--claim" @click="tasks.claimSeason()">
              <CoinIcon :size="18" />Забрать {{ season.rewardCoins }}
            </button>
            <span v-else class="coin coin--light"><CoinIcon :size="18" />+{{ season.rewardCoins }}</span>
          </template>
        </div>
        <button v-if="sheet" class="big__more" aria-label="Все задания" @click="emit('more')"><AppIcon name="chevron" :size="20" /></button>
      </article>
    </template>
  </div>
</template>

<style scoped lang="scss">
// measured on the 390pt mockups (выдвигаются задания.png, задания.png)
$blue: #0189ff;

.error {
  margin-bottom: 8px;
  font-size: 13px;
  color: #d93025;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 16px;
  h2 {
    font-size: 22px;
    font-weight: 600;
    color: #000;
    white-space: nowrap;
  }
}
.head__chips {
  display: flex;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  // one height for both looks (sheet / page), so the grid below does not move at the hand-over
  line-height: 20px;
  padding: 4px 12px;
  border-radius: 6px;
  background: #dcecfc;
  font-size: 14px;
  color: #5d9ad8;
  white-space: nowrap;
}

// sheet mockup: a wider count chip, no timer
.chip--count {
  padding: 4px 22px;
  font-size: 17px;
}

.day {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.task {
  display: flex;
  flex-direction: column;
  min-height: 122px;
  padding: 12px;
  border-radius: 8px;
  // the illustrations were cut on this colour
  background: #f8f8fe;
}
.task__title {
  font-size: 13px;
  font-weight: 600;
  line-height: 16px;
  color: #000;
}
.task__progress {
  margin-top: 4px;
  font-size: 12px;
  color: #8e8e93;
}
.task__foot {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  margin-top: auto;
  padding-top: 8px;
}
.task__art {
  width: 60px;
  height: 45px;
  margin-right: auto;
  object-fit: contain;
  object-position: left bottom;
}
.coin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: #e8eaf2;
  font-size: 12px;
  font-weight: 500;
  color: #5d9ad8;
  white-space: nowrap;
}
.coin--light {
  background: #d3e5fa;
}
.coin--claim {
  background: $blue;
  color: #fff;
  &:disabled {
    opacity: 0.6;
  }
}
.check {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid #9ec5ef;
  border-radius: 50%;
  background: #eef5fd;
  color: #fff;
}
.check--on {
  border-color: $blue;
  background: $blue;
}

.big {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-top: 6px;
  padding: 14px 12px 14px 16px;
  border-radius: 8px;
  // the illustrations were cut on this colour
  background: #e3eefd;
  &:first-of-type {
    margin-top: 32px;
  }
}
.big__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.big__kind {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6d6d6e;
}
.big__title {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 500;
  line-height: 19px;
  color: #000;
}
.big__count {
  margin-top: 10px;
  font-size: 12px;
  color: #8e8e93;
}
.bar {
  display: block;
  height: 6px;
  margin-top: 6px;
  border-radius: 3px;
  background: #cfe1f8;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: $blue;
  }
}
.big__side {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 4px;
}
.big__reward {
  margin-top: 10px;
}
.big__more {
  flex: none;
  align-self: center;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #cfe1f8;
  color: #000;
}
.big__art {
  width: 92px;
  height: 64px;
  object-fit: contain;
}
</style>
