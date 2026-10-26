<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { services } from '@/app/providers/services'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import type { LngLatPair, MapService } from '@/services/map/types'

/**
 * Meeting point for a new event: the pin stays in the middle and the player moves the map under it
 * (no tap targets to miss on a phone). Emits the centre after the map settles.
 */
const props = defineProps<{ center: LngLatPair }>()
const emit = defineEmits<{ change: [center: LngLatPair] }>()

const ZOOM = 15
const container = ref<HTMLDivElement | null>(null)
const failed = ref(false)
let map: MapService | null = null

onMounted(async () => {
  if (!container.value) return
  let instance: MapService
  try {
    instance = services().createMap()
  } catch {
    failed.value = true
    return
  }
  map = instance
  instance.onViewport(({ bbox }) => emit('change', [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2]))
  try {
    await instance.mount(container.value, { center: props.center, zoom: ZOOM, margin: [0, 0, 0, 0] })
    instance.render({
      districts: [],
      selectedDistrictId: null,
      buildings: [],
      selectedBuildingId: null,
      buildingsWithOutline: new Set(),
      outlines: [],
      selectedOutlineId: null,
      position: null,
      exploredCells: [],
      recentCells: [],
      fog: false,
    })
  } catch {
    if (map === instance) failed.value = true
  }
})

onBeforeUnmount(() => {
  map?.destroy()
  map = null
})
</script>

<template>
  <div class="picker">
    <div ref="container" class="picker__map" />
    <span v-if="!failed" class="picker__pin" aria-hidden="true">
      <span class="picker__halo" />
      <FilledIcon name="pin" :size="36" />
    </span>
    <p v-if="failed" class="picker__error" role="alert">Карта не загрузилась. Проверьте подключение и вернитесь на этот шаг.</p>
  </div>
</template>

<style scoped lang="scss">
.picker {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: #eef1f5;
}
.picker__map {
  position: absolute;
  inset: 0;
}
.picker__pin {
  position: absolute;
  left: 50%;
  top: 50%;
  // the tip of the pin marks the point
  transform: translate(-50%, -100%);
  color: #0189ff;
  pointer-events: none;
  display: grid;
  place-items: center;
}
.picker__halo {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgb(1 137 255 / 18%);
  transform: translate(-50%, -50%);
}
.picker__error {
  position: absolute;
  inset: auto 16px 16px;
  padding: 12px;
  border-radius: 10px;
  background: #fff;
  font-size: 14px;
}
</style>
