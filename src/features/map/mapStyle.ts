import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

/** Colors sampled from the design mockups (keep in sync with styles/main.scss tokens). */
export const MAP_COLORS = {
  background: '#F5F4F2',
  district: '#F2F2F7',
  districtLine: '#D6DAF0',
  districtLabel: '#5A7EE8',
  districtSelected: '#9FD1F9',
  accent: '#4DB1FA',
  water: '#E4EDF8',
  park: '#EAF1E6',
  road: '#FFFFFF',
  roadCasing: '#E6E6EC',
  building: '#E8E8EE',
  streetLabel: '#8E8E96',
} as const

/** Our own data layers are inserted before this layer, under roads and labels. */
export const DISTRICT_FILL_BEFORE = 'water'

/**
 * Flat "game board" basemap from the mockup: plain background with okrugs at
 * city zoom; water, roads and buildings fade in only when zooming in so the
 * player can still navigate to a building on foot.
 */
export function createMapStyle(tilesUrl: string): StyleSpecification {
  const fadeIn = (from: number, to: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], from, 0, to, 1]
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'vector',
        url: tilesUrl,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.background } },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        minzoom: 11,
        paint: { 'fill-color': MAP_COLORS.water, 'fill-opacity': fadeIn(11, 13) },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'park',
        minzoom: 12,
        paint: { 'fill-color': MAP_COLORS.park, 'fill-opacity': fadeIn(12, 14) },
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.roadCasing,
          'line-opacity': fadeIn(12, 13.5),
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1, 16, 10, 19, 34],
        },
      },
      {
        id: 'road',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.road,
          'line-opacity': fadeIn(12, 13.5),
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.5, 16, 8, 19, 30],
        },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'building',
        minzoom: 15,
        paint: { 'fill-color': MAP_COLORS.building, 'fill-opacity': fadeIn(15, 16) },
      },
      {
        id: 'street-label',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'transportation_name',
        minzoom: 15,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: { 'text-color': MAP_COLORS.streetLabel, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.2 },
      },
    ],
  }
}

/** Approximate visual centre of a multipolygon: area-weighted centroid of its largest part. */
export function labelPoint(geometry: GeoJSON.MultiPolygon): [number, number] | null {
  let best: { area: number; point: [number, number] } | null = null
  for (const polygon of geometry.coordinates) {
    const ring = polygon[0]
    if (!ring || ring.length < 4) continue
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0 = 0, y0 = 0] = ring[i] ?? []
      const [x1 = 0, y1 = 0] = ring[i + 1] ?? []
      const cross = x0 * y1 - x1 * y0
      a += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    if (a === 0) continue
    const area = Math.abs(a / 2)
    if (!best || area > best.area) best = { area, point: [cx / (3 * a), cy / (3 * a)] }
  }
  return best?.point ?? null
}

export function bounds(geometry: GeoJSON.MultiPolygon): [[number, number], [number, number]] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of geometry.coordinates)
    for (const ring of polygon)
      for (const [x = 0, y = 0] of ring) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/** "Old" Moscow plus the nearest part of New Moscow, as framed in the mockup. */
export const MOSCOW_BOUNDS: [[number, number], [number, number]] = [
  [37.33, 55.56],
  [37.9, 55.92],
]
