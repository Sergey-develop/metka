<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { DEFAULT_FILTER } from '@/services/exploration/trackFilter'
import { useExplorationStore } from '@/stores/exploration'

/** Where the route gets lost: GPS on the phone → client filter → upload → server verdict. */
defineEmits<{ close: [] }>()
const exploration = useExplorationStore()
const d = computed(() => exploration.diagnostics)

const REASONS: Record<string, string> = {
  too_fast: 'скачок (быстрее 7 м/с)',
  inaccurate: 'неточно (хуже 35 м)',
  bad_time: 'неверное время',
  out_of_order: 'повтор / не по порядку',
  outside_area: 'вне игровой зоны',
  invalid: 'ошибка данных',
}
const serverRejected = computed(() =>
  Object.entries(d.value.serverRejected)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${REASONS[reason] ?? reason}: ${n}`),
)
const m = (v: number | null) => (v === null ? '—' : `${Math.round(v)} м`)
</script>

<template>
  <section class="diag card" aria-label="Диагностика исследования">
    <header class="diag__head">
      <h2>Диагностика исследования</h2>
      <button type="button" class="diag__close" aria-label="Закрыть" @click="$emit('close')"><AppIcon name="close" :size="16" /></button>
    </header>
    <dl>
      <div>
        <dt>Экран</dt>
        <dd>{{ exploration.screenKeptOn ? 'не гаснет' : 'может погаснуть — тогда GPS остановится' }}</dd>
      </div>
      <div>
        <dt>Уходов в фон</dt>
        <dd>{{ exploration.backgroundStops }}</dd>
      </div>
      <div>
        <dt>Точек от GPS</dt>
        <dd>{{ d.fixes }} · точность: лучшая {{ m(d.bestAccuracyM) }}, сейчас {{ m(d.lastAccuracyM) }}</dd>
      </div>
      <div>
        <dt>Самый долгий перерыв GPS</dt>
        <dd>{{ Math.round(d.longestFixGapS) }} с</dd>
      </div>
      <div>
        <dt>Отброшено на телефоне</dt>
        <dd>
          неточно (хуже {{ DEFAULT_FILTER.maxAccuracyM }} м): {{ d.dropped.inaccurate }} · скачки: {{ d.dropped.outlier }} · стоя на месте:
          {{ d.dropped.too_close }} · не по порядку: {{ d.dropped.out_of_order }}
        </dd>
      </div>
      <div>
        <dt>Разрывы больше 30 с</dt>
        <dd>{{ d.gapsOver30s }} (через разрыв путь не открывается)</dd>
      </div>
      <div>
        <dt>Отправлено на сервер</dt>
        <dd>{{ d.sent }} точек · отправок {{ d.uploadsOk }}, ошибок {{ d.uploadsFailed }} · в очереди {{ exploration.pending }}</dd>
      </div>
      <div>
        <dt>Сервер принял</dt>
        <dd>{{ d.serverAccepted }} · открыто ячеек {{ d.newCells }}</dd>
      </div>
      <div v-if="serverRejected.length">
        <dt>Сервер отклонил</dt>
        <dd>{{ serverRejected.join(' · ') }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped lang="scss">
.diag {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 55vh;
  overflow-y: auto;
  dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  dt {
    font-size: 12px;
    color: var(--c-text-2);
  }
  dd {
    margin: 1px 0 0;
    font-size: 14px;
  }
}
.diag__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  h2 {
    font-size: 16px;
    font-weight: 700;
  }
}
.diag__close {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-bg);
  color: var(--c-text-2);
}
</style>
