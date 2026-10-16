<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { DistrictOverview } from '@/types/game'

const props = defineProps<{ district: DistrictOverview }>()
defineEmits<{ close: [] }>()

const share = computed(() =>
  props.district.totalBuildings > 0 ? props.district.discoveredBuildings / props.district.totalBuildings : 0,
)
</script>

<template>
  <article class="district card" aria-live="polite">
    <header class="district__head">
      <h2>{{ district.shortName }}</h2>
      <button class="district__close" aria-label="Закрыть" @click="$emit('close')"><AppIcon name="close" :size="14" /></button>
    </header>

    <div
      class="split"
      role="progressbar"
      :aria-valuenow="district.discoveredBuildings"
      :aria-valuemax="district.totalBuildings"
      aria-label="Изучено объектов"
    >
      <div class="split__done" :style="{ flexGrow: Math.max(share, district.discoveredBuildings > 0 ? 0.12 : 0) }">
        <span v-if="district.discoveredBuildings > 0">{{ district.discoveredBuildings }}</span>
      </div>
      <div class="split__rest" :style="{ flexGrow: Math.max(1 - share, 0.12) }">
        <span>{{ district.totalBuildings }}</span>
      </div>
    </div>

    <dl class="stats">
      <div>
        <dt>Изучено точек</dt>
        <dd>{{ district.discoveredBuildings }}<small>Объектов</small></dd>
      </div>
      <div>
        <dt>Всего</dt>
        <dd>{{ district.totalBuildings }}<small>Объектов</small></dd>
      </div>
    </dl>

    <p class="district__foot">
      <span>{{ district.name }}</span>
      <RouterLink to="/clan">Влияние: {{ district.myInfluence }} →</RouterLink>
    </p>
  </article>
</template>

<style scoped lang="scss">
.district {
  padding: 22px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: rise 0.25s var(--ease);
}
.district__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  h2 {
    font-size: 26px;
    font-weight: 700;
    color: #2b2f36;
  }
}
.district__close {
  width: 52px;
  height: 26px;
  border: 0;
  border-radius: 9px;
  background: var(--c-surface-2);
  display: grid;
  place-items: center;
  color: var(--c-text);
}
.split {
  display: flex;
  height: 26px;
  border-radius: 7px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.25px;
}
.split__done,
.split__rest {
  flex-basis: 0;
  display: grid;
  place-items: center;
  transition: flex-grow 0.5s var(--ease);
}
.split__done {
  background: var(--c-accent);
  color: #fff;
}
.split__rest {
  background: var(--c-accent-track);
  color: var(--c-accent);
}
.stats {
  display: flex;
  gap: 32px;
  margin: 0;
  dt {
    font-size: 12px;
    color: var(--c-text-3);
    margin-bottom: 2px;
  }
  dd {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 4px;
    color: var(--c-accent);
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
    small {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
  }
}
.district__foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--c-text-2);
  a {
    flex: none;
    color: var(--c-accent-strong);
    text-decoration: none;
    font-weight: 600;
  }
}
@keyframes rise {
  from {
    transform: translateY(16px);
    opacity: 0;
  }
}
</style>
