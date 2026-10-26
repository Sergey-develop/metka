<script setup lang="ts">
import { computed, ref } from 'vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'

export type Company = 'solo' | 'pair' | 'kids' | 'group'
export type Range = 'near' | 'district' | 'city'

const emit = defineEmits<{ next: [choice: { company: Company; range: Range }] }>()

const COMPANY: { id: Company; label: string }[] = [
  { id: 'solo', label: 'Один' },
  { id: 'pair', label: 'Вдвоем' },
  { id: 'kids', label: 'С детьми' },
  { id: 'group', label: 'Компанией' },
]
const RANGE: { id: Range; label: string; hint: string }[] = [
  { id: 'near', label: 'Рядом', hint: 'До 1 км' },
  { id: 'district', label: 'Мой район', hint: 'До 5 км' },
  { id: 'city', label: 'По всей Москве', hint: 'Без ограничений' },
]

const company = ref<Company | null>(null)
const range = ref<Range | null>(null)
const ready = computed(() => company.value !== null && range.value !== null)

function next(): void {
  if (company.value && range.value) emit('next', { company: company.value, range: range.value })
}
</script>

<template>
  <div class="sw">
    <section class="sw__card">
      <div class="sw__row">
        <h2 id="sw-company">С кем идешь?</h2>
        <span class="sw__step">1/2</span>
      </div>
      <div class="who" role="radiogroup" aria-labelledby="sw-company">
        <button
          v-for="c in COMPANY"
          :key="c.id"
          class="who__opt"
          :class="{ on: company === c.id }"
          role="radio"
          :aria-checked="company === c.id"
          @click="company = c.id"
        >
          <svg width="80" height="56" viewBox="0 0 80 56" fill="currentColor" aria-hidden="true">
            <template v-if="c.id === 'solo'">
              <circle cx="40" cy="12" r="12" />
              <rect x="25" y="28" width="30" height="24" rx="12" />
            </template>
            <template v-else-if="c.id === 'pair'">
              <circle cx="35" cy="12" r="11" />
              <rect x="20" y="27" width="30" height="23" rx="11.5" />
              <circle cx="44" cy="12" r="12" stroke="#fff" stroke-width="3" />
              <rect x="30" y="28" width="32" height="24" rx="12" stroke="#fff" stroke-width="3" />
            </template>
            <template v-else-if="c.id === 'kids'">
              <circle cx="24" cy="10" r="8" />
              <rect x="12" y="21" width="24" height="18" rx="9" />
              <circle cx="56" cy="10" r="8" />
              <rect x="44" y="21" width="24" height="18" rx="9" />
              <circle cx="32" cy="32" r="6" stroke="#fff" stroke-width="2.5" />
              <rect x="22" y="40" width="20" height="14" rx="7" stroke="#fff" stroke-width="2.5" />
              <circle cx="48" cy="32" r="6" stroke="#fff" stroke-width="2.5" />
              <rect x="38" y="40" width="20" height="14" rx="7" stroke="#fff" stroke-width="2.5" />
            </template>
            <template v-else>
              <circle cx="28" cy="12" r="10" />
              <rect x="14" y="26" width="28" height="22" rx="11" />
              <circle cx="52" cy="12" r="10" />
              <rect x="38" y="26" width="28" height="22" rx="11" />
              <circle cx="40" cy="14" r="11" stroke="#fff" stroke-width="3" />
              <rect x="24" y="29" width="32" height="24" rx="12" stroke="#fff" stroke-width="3" />
            </template>
          </svg>
          <span>{{ c.label }}</span>
        </button>
      </div>
    </section>

    <section class="sw__card">
      <div class="sw__row">
        <h2 id="sw-range">Как далеко?</h2>
        <span class="sw__step">2/2</span>
      </div>
      <div class="far" role="radiogroup" aria-labelledby="sw-range">
        <button
          v-for="r in RANGE"
          :key="r.id"
          class="far__opt"
          role="radio"
          :aria-checked="range === r.id"
          @click="range = r.id"
        >
          <FilledIcon name="pin" :size="28" class="far__pin" />
          <span class="far__text">
            <b>{{ r.label }}</b>
            <small>{{ r.hint }}</small>
          </span>
          <span class="far__radio" :class="{ on: range === r.id }" aria-hidden="true" />
        </button>
      </div>
    </section>

    <button class="sw__next" :disabled="!ready" @click="next">Далее</button>
  </div>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (тиндер.png, 3x)
$blue: #0189ff;
$tile: #edf2fb;

.sw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sw__card {
  padding: 16px 16px 16px;
  border-radius: 12px;
  background: #f9f9fc;
}
.sw__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  h2 {
    font-size: 17px;
    font-weight: 500;
    line-height: 22px;
    color: #000;
  }
}
.sw__step {
  min-width: 67px;
  padding: 2px 0;
  border-radius: 4px;
  background: #e3eefd;
  color: #3d93f2;
  font-size: 14px;
  text-align: center;
}

.who {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.who__opt {
  height: 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: $tile;
  color: #c9def7;
  svg {
    height: 42px;
    width: auto;
    // the white strokes separate overlapping figures; on the tile they must match its colour
    :deep([stroke]) {
      stroke: $tile;
    }
  }
  span {
    color: #000;
    font-size: 14px;
    font-weight: 500;
  }
  &.on {
    border-color: $blue;
    background: #cde3fa;
    color: #fff;
    svg :deep([stroke]) {
      stroke: #cde3fa;
    }
  }
}

.far {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.far__opt {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 12px 0 14px;
  border: 0;
  border-radius: 6px;
  background: $tile;
  text-align: left;
}
.far__pin {
  flex: none;
  color: $blue;
}
.far__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  b {
    font-size: 15px;
    font-weight: 500;
    line-height: 18px;
    color: #000;
  }
  small {
    font-size: 13px;
    line-height: 16px;
    color: #85858c;
  }
}
.far__radio {
  flex: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid #c7c7cc;
  border-radius: 50%;
  &.on {
    border: 1.5px solid $blue;
    background: radial-gradient(circle, $blue 0 5px, #fff 5.5px);
  }
}

.sw__next {
  position: sticky;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 12px);
  z-index: 20;
  height: 50px;
  margin-top: 8px;
  border: 0;
  border-radius: 8px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  &:disabled {
    opacity: 0.5;
  }
}
</style>
