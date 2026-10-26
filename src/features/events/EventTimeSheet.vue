<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import PickerSheet from './PickerSheet.vue'

/** «Выбор времени» (Страница локации-3): hour and minute wheels (scroll-snap; a tap also picks). */
const props = defineProps<{ hour: number; minute: number }>()
const emit = defineEmits<{ close: []; apply: [hour: number, minute: number] }>()

const ROW = 52
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const pad = (n: number) => String(n).padStart(2, '0')

const hour = ref(props.hour)
const minute = ref(props.minute)
const hoursEl = ref<HTMLElement | null>(null)
const minutesEl = ref<HTMLElement | null>(null)

function scrollTo(el: HTMLElement | null, index: number, smooth: boolean): void {
  el?.scrollTo({ top: index * ROW, behavior: smooth ? 'smooth' : 'auto' })
}

function onScroll(which: 'h' | 'm', event: Event): void {
  const el = event.target as HTMLElement
  const index = Math.round(el.scrollTop / ROW)
  if (which === 'h') hour.value = Math.min(23, Math.max(0, index))
  else minute.value = Math.min(59, Math.max(0, index))
}

function pick(which: 'h' | 'm', value: number): void {
  if (which === 'h') {
    hour.value = value
    scrollTo(hoursEl.value, value, true)
  } else {
    minute.value = value
    scrollTo(minutesEl.value, value, true)
  }
}

function reset(): void {
  pick('h', props.hour)
  pick('m', props.minute)
}

onMounted(async () => {
  await nextTick()
  scrollTo(hoursEl.value, hour.value, false)
  scrollTo(minutesEl.value, minute.value, false)
})
</script>

<template>
  <PickerSheet
    title="Выбор времени"
    :can-reset="hour !== props.hour || minute !== props.minute"
    @close="emit('close')"
    @reset="reset"
    @apply="emit('apply', hour, minute)"
  >
    <div class="wheels" :style="{ '--row': `${ROW}px` }">
      <span class="wheels__band" aria-hidden="true" />
      <div ref="hoursEl" class="wheel" role="listbox" aria-label="Часы" @scroll.passive="onScroll('h', $event)">
        <button v-for="h in HOURS" :key="h" class="wheel__item" :class="{ on: h === hour }" role="option" :aria-selected="h === hour" @click="pick('h', h)">
          {{ pad(h) }}
        </button>
      </div>
      <div ref="minutesEl" class="wheel" role="listbox" aria-label="Минуты" @scroll.passive="onScroll('m', $event)">
        <button v-for="m in MINUTES" :key="m" class="wheel__item" :class="{ on: m === minute }" role="option" :aria-selected="m === minute" @click="pick('m', m)">
          {{ pad(m) }}
        </button>
      </div>
    </div>
  </PickerSheet>
</template>

<style scoped lang="scss">
.wheels {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  height: calc(var(--row) * 5);
}
.wheels__band {
  // the selected row, behind both wheels
  position: absolute;
  left: 0;
  right: 0;
  top: calc(var(--row) * 2);
  height: var(--row);
  border-radius: 6px;
  background: #f0f7ff;
}
.wheel {
  position: relative;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  // two empty rows above and below so the first and last values can reach the middle
  padding: calc(var(--row) * 2) 0;
  &::-webkit-scrollbar {
    display: none;
  }
}
.wheel__item {
  display: block;
  width: 100%;
  height: var(--row);
  padding: 0;
  border: 0;
  background: none;
  scroll-snap-align: center;
  font-size: 28px;
  color: #d1d1d6;
  &.on {
    color: #000;
  }
}
</style>
