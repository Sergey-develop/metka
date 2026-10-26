<script setup lang="ts">
import { computed } from 'vue'
import type { DistrictOverview } from '@/types/game'
import { GAME_AREAS, type GameAreaId } from '@/utils/gameAreas'

/**
 * «Ты открыл X% Москвы»: share of game buildings discovered, over a flat map of the okrugs.
 * `highlight` paints okrugs (e.g. a clan's territory); `lead` is the caption's first line (another
 * player's name on their profile); the default slot replaces the caption.
 * `area` other than Moscow («…% Завидово»): no okrugs there, the share comes in `areaProgress`.
 */
const props = withDefaults(
  defineProps<{
    districts: DistrictOverview[]
    highlight?: string[]
    lead?: string
    area?: GameAreaId
    areaProgress?: { total: number; discovered: number } | null
  }>(),
  {
    highlight: undefined,
    lead: 'Ты открыл',
    area: 'moscow',
    areaProgress: null,
  },
)
const isMoscow = computed(() => props.area === 'moscow')
const areaName = computed(() => GAME_AREAS.find((a) => a.id === props.area)!.of)

// framing taken from the mockup: ЦАО centre sits at (300, 119) of a 358×200 card, Moscow cut by the right edge
const W = 358
const H = 200
const CENTER = { lng: 37.62, lat: 55.755, x: 300, y: 119 }
const PX_PER_LNG = 300
const PX_PER_LAT = PX_PER_LNG / Math.cos((CENTER.lat * Math.PI) / 180)

const project = ([lng, lat]: number[]): [number, number] => [
  CENTER.x + ((lng ?? 0) - CENTER.lng) * PX_PER_LNG,
  CENTER.y - ((lat ?? 0) - CENTER.lat) * PX_PER_LAT,
]

const shapes = computed(() =>
  (isMoscow.value ? props.districts : []).map((d) => {
    let d3 = ''
    let largest: number[][] = []
    for (const polygon of d.boundary.coordinates) {
      for (const ring of polygon) {
        d3 += ring.map((pt, i) => `${i ? 'L' : 'M'}${project(pt).map((v) => v.toFixed(1)).join(' ')}`).join('') + 'Z'
      }
      const outer = polygon[0] ?? []
      if (outer.length > largest.length) largest = outer
    }
    const pts = largest.map(project)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const label = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    return { id: d.id, path: d3, name: d.shortName, label, on: props.highlight?.includes(d.id) ?? false }
  }),
)

const percent = computed(() => {
  const total = isMoscow.value ? props.districts.reduce((sum, d) => sum + d.totalBuildings, 0) : (props.areaProgress?.total ?? 0)
  const found = isMoscow.value
    ? props.districts.reduce((sum, d) => sum + d.discoveredBuildings, 0)
    : (props.areaProgress?.discovered ?? 0)
  const value = total > 0 ? (found / total) * 100 : 0
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
})
</script>

<template>
  <section class="mcard" :aria-label="$slots.default ? undefined : `${lead} ${percent}% ${areaName}`">
    <svg class="mcard__map" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <path v-for="s in shapes" :key="s.id" class="mcard__okrug" :class="{ 'mcard__okrug--on': s.on }" :d="s.path" />
      <text v-for="s in shapes" :key="`${s.id}-l`" class="mcard__label" :x="s.label.x" :y="s.label.y">{{ s.name }}</text>
    </svg>
    <slot>
      <p class="mcard__lead">{{ lead }}</p>
      <p class="mcard__value">{{ percent }}% {{ areaName }}</p>
    </slot>
  </section>
</template>

<style scoped lang="scss">
.mcard {
  position: relative;
  height: 200px;
  padding: 16px 17px;
  border-radius: 12px;
  overflow: hidden;
  background: #e3eefd;
  color: #0189ff;
}
.mcard__map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.mcard__okrug {
  fill: #f1f1f6;
  fill-rule: evenodd;
  stroke: #c3cede;
  stroke-width: 0.6;
  stroke-linejoin: round;
}
.mcard__okrug--on {
  fill: rgb(1 137 255 / 35%);
  stroke: #0189ff;
}
.mcard__label {
  fill: #2e9cfe;
  font-size: 5px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: middle;
}
.mcard__lead,
.mcard__value {
  position: relative;
}
.mcard__lead {
  font-size: 20px;
  line-height: 24px;
}
.mcard__value {
  margin-top: 6px;
  font-size: 34px;
  font-weight: 500;
  line-height: 40px;
  letter-spacing: -0.01em;
}
</style>
