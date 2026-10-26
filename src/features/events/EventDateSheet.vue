<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { type DayValue, dayOrder, monthGrid, sameDay } from './eventKinds'
import PickerSheet from './PickerSheet.vue'

/** «Выбор даты» (Страница локации-2): a month grid from Monday; days outside [min, max] are disabled. */
const props = defineProps<{ value: DayValue; min: DayValue; max: DayValue }>()
const emit = defineEmits<{ close: []; apply: [day: DayValue] }>()

const picked = ref<DayValue>({ ...props.value })
const view = ref({ year: props.value.year, month: props.value.month })

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const title = computed(() => {
  const name = new Date(Date.UTC(view.value.year, view.value.month - 1, 1)).toLocaleDateString('ru-RU', { month: 'long', timeZone: 'UTC' })
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${view.value.year}`
})
const cells = computed(() => monthGrid(view.value.year, view.value.month))
const allowed = (d: DayValue) => dayOrder(d) >= dayOrder(props.min) && dayOrder(d) <= dayOrder(props.max)
const monthKey = (y: number, m: number) => y * 100 + m
const canPrev = computed(() => monthKey(view.value.year, view.value.month) > monthKey(props.min.year, props.min.month))
const canNext = computed(() => monthKey(view.value.year, view.value.month) < monthKey(props.max.year, props.max.month))

function shift(by: number): void {
  const m = view.value.month - 1 + by
  view.value = { year: view.value.year + Math.floor(m / 12), month: (((m % 12) + 12) % 12) + 1 }
}

function reset(): void {
  picked.value = { ...props.value }
  view.value = { year: props.value.year, month: props.value.month }
}
</script>

<template>
  <PickerSheet title="Выбор даты" :can-reset="!sameDay(picked, value)" @close="emit('close')" @reset="reset" @apply="emit('apply', picked)">
    <div class="cal__head">
      <span class="cal__month" aria-live="polite">{{ title }}</span>
      <button class="cal__nav" aria-label="Предыдущий месяц" :disabled="!canPrev" @click="shift(-1)"><AppIcon name="back" :size="20" /></button>
      <button class="cal__nav" aria-label="Следующий месяц" :disabled="!canNext" @click="shift(1)"><AppIcon name="chevron" :size="20" /></button>
    </div>
    <div class="cal__grid" role="grid" :aria-label="title">
      <span v-for="w in WEEKDAYS" :key="w" class="cal__wd" role="columnheader">{{ w }}</span>
      <button
        v-for="c in cells"
        :key="`${c.day.month}-${c.day.day}`"
        class="cal__day"
        :class="{ 'cal__day--out': !c.inMonth, 'cal__day--on': sameDay(c.day, picked) }"
        :disabled="!c.inMonth || !allowed(c.day)"
        :aria-pressed="sameDay(c.day, picked)"
        @click="picked = c.day"
      >
        {{ c.day.day }}
      </button>
    </div>
  </PickerSheet>
</template>

<style scoped lang="scss">
.cal__head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0 12px 12px;
}
.cal__month {
  flex: 1;
  font-size: 17px;
  font-weight: 500;
  color: #3c3c43;
}
.cal__nav {
  width: 44px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: #000;
  &:disabled {
    color: #c7c7cc;
  }
}
.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 4px;
  text-align: center;
}
.cal__wd {
  padding-bottom: 8px;
  font-size: 13px;
  color: #0189ff;
}
.cal__day {
  justify-self: center;
  width: 40px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  font-size: 17px;
  color: #000;
  &:disabled {
    color: #c7c7cc;
  }
  &--out {
    color: #d1d1d6;
  }
  &--on {
    background: #0189ff;
    color: #fff;
  }
}
</style>
