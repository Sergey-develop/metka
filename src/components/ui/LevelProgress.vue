<script setup lang="ts">
import { computed } from 'vue'
import { levelProgress } from '@/features/progression/levels'

/**
 * «4 уровень» with the XP bar and «326/1500» (profile and the map's header).
 * `stacked` puts the numbers under the bar (map mockup) instead of beside it (profile mockup).
 */
const props = defineProps<{ level: number | null; xp: number; stacked?: boolean }>()
const progress = computed(() => levelProgress(props.xp))
</script>

<template>
  <span class="lvl" :class="{ 'lvl--stacked': stacked }">
    <b class="lvl__title">{{ level ?? '—' }} уровень</b>
    <span class="lvl__bar">
      <span
        class="lvl__track"
        role="progressbar"
        :aria-valuenow="progress.xpIntoLevel"
        :aria-valuemax="progress.xpForNextLevel"
        aria-label="Опыт до следующего уровня"
      >
        <span :style="{ width: `${progress.ratio * 100}%` }" />
      </span>
      <small class="lvl__xp">{{ progress.xpIntoLevel }}/{{ progress.xpForNextLevel }}</small>
    </span>
  </span>
</template>

<style scoped lang="scss">
.lvl {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.lvl__title {
  font-size: 14px;
  font-weight: 600;
  line-height: 17px;
  color: #000;
}
.lvl__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.lvl__track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #cfe6fc;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: #0189ff;
  }
}
.lvl__xp {
  font-size: 10px;
  color: #cce7ff;
}
.lvl--stacked {
  .lvl__title {
    font-size: 17px;
    line-height: 20px;
  }
  .lvl__bar {
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
  }
  .lvl__track {
    flex: none;
    height: 7px;
  }
  .lvl__xp {
    font-size: 11px;
    color: #0189ff;
  }
}
</style>
