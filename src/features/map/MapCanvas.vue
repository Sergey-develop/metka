<script setup lang="ts">
import { GeoJSONSource, Map as MapLibre, Marker, type MapLayerMouseEvent } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GeoFix } from '@/services/geolocation/types'
import type { Bbox, DistrictOverview, MapBuilding } from '@/types/game'
import { bounds, createMapStyle, DISTRICT_FILL_BEFORE, labelPoint, MAP_COLORS, MOSCOW_BOUNDS } from './mapStyle'

const props = defineProps<{
  tilesUrl: string
  buildings: MapBuilding[]
  districts: DistrictOverview[]
  position: GeoFix | null
  selectedBuildingId: string | null
  selectedDistrictId: string | null
  /** px covered by overlays (header, tab bar) so fitBounds keeps content visible */
  padding: { top: number; bottom: number }
}>()

const emit = defineEmits<{
  viewport: [bbox: Bbox]
  selectBuilding: [id: string]
  selectDistrict: [id: string | null]
  error: [message: string]
}>()

const container = ref<HTMLDivElement | null>(null)
let map: MapLibre | null = null
let ready = false
let percentMarker: Marker | null = null

const BUILDINGS_MINZOOM = 11.5

function buildingsGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: props.buildings.map((b) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
      properties: {
        id: b.id,
        rarity: b.rarity,
        discovered: b.discoveredAt !== null,
        selected: b.id === props.selectedBuildingId,
      },
    })),
  }
}

function districtsGeoJson(): GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: props.districts.map((d) => ({
      type: 'Feature',
      geometry: d.boundary,
      properties: { id: d.id, selected: d.id === props.selectedDistrictId },
    })),
  }
}

function districtLabelsGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: props.districts.flatMap((d) => {
      const point = labelPoint(d.boundary)
      return point
        ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: point }, properties: { id: d.id, label: d.shortName } }]
        : []
    }),
  }
}

function positionGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const p = props.position
  return {
    type: 'FeatureCollection',
    features: p
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { accuracy: p.accuracyM } }]
      : [],
  }
}

function setSource(id: string, data: GeoJSON.FeatureCollection): void {
  const source = map?.getSource(id)
  if (source instanceof GeoJSONSource) void source.setData(data)
}

function emitViewport(): void {
  if (!map) return
  const b = map.getBounds()
  emit('viewport', { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() })
}

function fitPadding() {
  return { top: props.padding.top + 16, bottom: props.padding.bottom + 16, left: 16, right: 16 }
}

/** White "58%" pin over the selected district, as in the mockup. */
function updatePercentMarker(): void {
  percentMarker?.remove()
  percentMarker = null
  const district = props.districts.find((d) => d.id === props.selectedDistrictId)
  const point = district ? labelPoint(district.boundary) : null
  if (!map || !district || !point) return
  const percent = district.totalBuildings > 0 ? Math.round((100 * district.discoveredBuildings) / district.totalBuildings) : 0
  const el = document.createElement('div')
  el.className = 'percent-pin'
  el.setAttribute('aria-label', `Изучено ${percent}%`)
  el.innerHTML = `<span class="percent-pin__value">${percent}%</span>`
  percentMarker = new Marker({ element: el, anchor: 'bottom' }).setLngLat(point).addTo(map)
}

function addLayers(m: MapLibre): void {
  m.addSource('districts', { type: 'geojson', data: districtsGeoJson() })
  m.addSource('district-labels', { type: 'geojson', data: districtLabelsGeoJson() })
  m.addSource('buildings', { type: 'geojson', data: buildingsGeoJson() })
  m.addSource('me', { type: 'geojson', data: positionGeoJson() })

  // okrug fills sit under water/roads so streets stay readable when zoomed in
  m.addLayer(
    {
      id: 'districts-fill',
      type: 'fill',
      source: 'districts',
      paint: {
        'fill-color': ['case', ['get', 'selected'], MAP_COLORS.districtSelected, MAP_COLORS.district],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, ['case', ['get', 'selected'], 0.45, 0.6]],
      },
    },
    DISTRICT_FILL_BEFORE,
  )
  m.addLayer({
    id: 'districts-line',
    type: 'line',
    source: 'districts',
    paint: { 'line-color': MAP_COLORS.districtLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2] },
  })
  m.addLayer({
    id: 'districts-label',
    type: 'symbol',
    source: 'district-labels',
    maxzoom: 12.5,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 13,
      'text-font': ['Noto Sans Bold'],
      'text-letter-spacing': 0.04,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': MAP_COLORS.districtLabel },
  })
  m.addLayer({
    id: 'me-accuracy',
    type: 'circle',
    source: 'me',
    minzoom: 12,
    paint: {
      'circle-color': MAP_COLORS.accent,
      'circle-opacity': 0.14,
      'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 12, ['/', ['get', 'accuracy'], 38], 20, ['/', ['get', 'accuracy'], 0.15]],
    },
  })
  m.addLayer({
    id: 'me-dot',
    type: 'circle',
    source: 'me',
    paint: { 'circle-radius': 7, 'circle-color': MAP_COLORS.accent, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
  })
  m.addLayer({
    id: 'buildings-circle',
    type: 'circle',
    source: 'buildings',
    minzoom: BUILDINGS_MINZOOM,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MINZOOM, 4, 16, ['case', ['get', 'selected'], 15, 11]],
      'circle-color': [
        'case',
        ['get', 'discovered'],
        MAP_COLORS.accent,
        ['match', ['get', 'rarity'], 'legendary', '#FF94DE', 'epic', '#9B8CF5', 'rare', '#6E9CF2', '#B9BCC8'],
      ],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MINZOOM, 0, BUILDINGS_MINZOOM + 0.5, 1],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MINZOOM, 0, BUILDINGS_MINZOOM + 0.5, 1],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['get', 'selected'], 4, 2.5],
    },
  })

  m.on('click', 'buildings-circle', (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties.id
    if (typeof id === 'string') emit('selectBuilding', id)
  })
  m.on('click', (e) => {
    if (m.queryRenderedFeatures(e.point, { layers: ['buildings-circle'] }).length > 0) return
    const id = m.queryRenderedFeatures(e.point, { layers: ['districts-fill'] })[0]?.properties.id
    emit('selectDistrict', typeof id === 'string' && id !== props.selectedDistrictId ? id : null)
  })
  for (const layer of ['buildings-circle', 'districts-fill']) {
    m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
  }
}

onMounted(() => {
  if (!container.value) return
  map = new MapLibre({
    container: container.value,
    style: createMapStyle(props.tilesUrl),
    bounds: MOSCOW_BOUNDS,
    fitBoundsOptions: { padding: fitPadding() },
    minZoom: 8,
    maxZoom: 19,
    attributionControl: { compact: true },
    pitchWithRotate: false,
    dragRotate: false,
  })
  map.touchZoomRotate.disableRotation()
  map.on('load', () => {
    if (!map) return
    addLayers(map)
    ready = true
    emitViewport()
  })
  map.on('moveend', emitViewport)
  map.on('error', (e) => emit('error', e.error.message))
})

onBeforeUnmount(() => {
  percentMarker?.remove()
  map?.remove()
  map = null
  ready = false
})

watch(
  () => [props.buildings, props.selectedBuildingId] as const,
  () => ready && setSource('buildings', buildingsGeoJson()),
)
watch(
  () => [props.districts, props.selectedDistrictId] as const,
  () => {
    if (!ready) return
    setSource('districts', districtsGeoJson())
    setSource('district-labels', districtLabelsGeoJson())
    updatePercentMarker()
  },
)
watch(
  () => props.position,
  () => ready && setSource('me', positionGeoJson()),
)

function flyTo(lng: number, lat: number, zoom = 16): void {
  map?.flyTo({ center: [lng, lat], zoom, essential: true, padding: fitPadding() })
}

function fitDistrict(districtId: string): void {
  const district = props.districts.find((d) => d.id === districtId)
  if (district) map?.fitBounds(bounds(district.boundary), { padding: fitPadding(), maxZoom: 13.5 })
}

function showCity(): void {
  map?.fitBounds(MOSCOW_BOUNDS, { padding: fitPadding() })
}

defineExpose({ flyTo, fitDistrict, showCity })
</script>

<template>
  <div ref="container" class="map-canvas" role="application" aria-label="Карта города" />
</template>

<style scoped lang="scss">
.map-canvas {
  position: absolute;
  inset: 0;
  background: var(--c-map-bg);
}

:deep(.percent-pin) {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: var(--c-surface);
  display: grid;
  place-items: center;
  box-shadow: 0 6px 18px rgb(23 61 102 / 14%);
  animation: pin-in 0.3s var(--ease);
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    bottom: -9px;
    left: 50%;
    width: 18px;
    height: 18px;
    background: var(--c-surface);
    transform: translateX(-50%) rotate(45deg);
    border-radius: 3px;
  }
}

:deep(.percent-pin__value) {
  position: relative;
  z-index: 1;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--c-accent-soft);
  display: grid;
  place-items: center;
  color: var(--c-accent);
  font-weight: 800;
  font-size: 18px;
}

:deep(.maplibregl-ctrl-bottom-right),
:deep(.maplibregl-ctrl-bottom-left) {
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
}

@keyframes pin-in {
  from {
    transform: translateY(8px) scale(0.9);
    opacity: 0;
  }
}
</style>
