import type {
  DrawingStyle,
  LngLat,
  LngLatBounds,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry,
  YMap,
  YMapFeature,
  YMapDefaultSchemeLayer,
  YMapListener,
  YMapMarker,
} from '@yandex/ymaps3-types'
import type { BuildingOutline, DistrictOverview, MapBuilding, Rarity } from '@/types/game'
import { cellsToMultiPolygon, type Cell } from '@/services/exploration/grid'
import { containsPoint, labelPoint, toLngLat } from '@/utils/mapGeometry'
import type { YmapsApi } from './yandexLoader'
import type { LngLatPair, MapInit, MapScene, MapService, MapTarget, MapViewport } from './types'

/** Colors from the design mockups (keep in sync with styles/main.scss tokens). */
export const MAP_COLORS = {
  accent: '#4DB1FA',
  selected: '#2F7CF6',
  district: '#F2F2F7',
  districtLine: '#C9CFEA',
  districtSelected: '#9FD1F9',
  plainStroke: '#8E97AB',
  unavailable: '#B9BCC8',
} as const

const RARITY_COLORS: Record<Rarity, string> = {
  common: '#8E97AB',
  rare: '#6E9CF2',
  epic: '#9B8CF5',
  legendary: '#FF94DE',
}

/** Game points are hidden below this zoom; district labels above DISTRICT_LABEL_MAX_ZOOM. */
const POINTS_MIN_ZOOM = 11.5
const DISTRICT_LABEL_MAX_ZOOM = 12.5
/**
 * City view is a flat "game board": opaque okrugs on a plain background, no basemap.
 * From this zoom the Yandex basemap appears and district fills turn translucent.
 */
const BASEMAP_MIN_ZOOM = 11.5
const DISTRICT_NEAR_ZOOM = BASEMAP_MIN_ZOOM
/**
 * Panning stays within Moscow incl. New Moscow. Unlike `map.bounds` (top-left, bottom-right),
 * restrictMapArea expects [south-west, north-east] — verified in Chrome against JS API 3.0.
 * The area must stay larger than the viewport at the minimum zoom, or Yandex misplaces the centre.
 */
const MAP_AREA: LngLatBounds = [
  [36.8, 55.1],
  [38.4, 56.2],
]
const MIN_ZOOM = 9.5
/**
 * Explored cells live in their own layer above the basemap and below our features layer (1500),
 * so district fog, footprints and DOM markers stay on top. Yandex draws basemap labels and icons
 * above all vector layers, so street names stay readable over the fill (checked in Chrome).
 * Do NOT slot it between the basemap sublayers (ground 1000 … labels 1300): at 1150 Yandex
 * stops rendering labels and icons altogether (JS API 3.0, verified 2026-10-18).
 */
const EXPLORED_SOURCE = 'metka-explored'
const EXPLORED_Z_INDEX = 1450
const VIEWPORT_SETTLE_MS = 200
/** Longer than pauses inside a wheel/trackpad zoom, so the basemap is not shown mid-gesture. */
const BASEMAP_SETTLE_MS = 450

/** Calm basemap: no POI icons/labels, no 3D buildings. Our layers carry the game state. */
const SCHEME_CUSTOMIZATION = {
  'render-3d': 'off' as const,
  style: [
    { tags: { any: ['poi'] }, elements: 'label' as const, stylers: { visibility: 'off' as const } },
    { tags: { any: ['poi'] }, types: 'point' as const, stylers: { visibility: 'off' as const } },
  ],
}

type Props = Exclude<MapTarget, null>

/** Reads back what we stored in an entity's `properties` (untyped in the Yandex API). */
export function targetOf(properties: Record<string, unknown> | undefined): MapTarget {
  const kind = properties?.kind
  const id = properties?.id
  if (kind === 'outline' && typeof id === 'number') return { kind, id }
  if ((kind === 'building' || kind === 'district') && typeof id === 'string') return { kind, id }
  return null
}

type OverlayGeometry = BuildingOutline['geometry'] | GeoJSON.MultiPolygon

export function toYandexGeometry(g: OverlayGeometry): PolygonGeometry | MultiPolygonGeometry | PointGeometry {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: toLngLat(g.coordinates) }
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((ring) => ring.map(toLngLat)) }
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map((ring) => ring.map(toLngLat))) }
  }
}

export function outlineStyle(o: BuildingOutline, selected: boolean): DrawingStyle {
  const g = o.game
  if (selected) {
    return { zIndex: 40, fill: MAP_COLORS.selected, fillOpacity: 0.22, stroke: [{ color: MAP_COLORS.selected, width: 3 }], cursor: 'pointer' }
  }
  if (!g) {
    // plain geography: thin outline, near-invisible fill so the footprint stays tappable
    return { zIndex: 20, fill: '#FFFFFF', fillOpacity: 0.01, stroke: [{ color: MAP_COLORS.plainStroke, width: 0.8, opacity: 0.6 }], cursor: 'pointer' }
  }
  if (g.status === 'unavailable') {
    return { zIndex: 30, fill: MAP_COLORS.unavailable, fillOpacity: 0.25, stroke: [{ color: MAP_COLORS.unavailable, width: 1.2, dash: [4, 3] }], cursor: 'pointer' }
  }
  const color = g.discoveredAt ? MAP_COLORS.accent : RARITY_COLORS[g.rarity]
  return { zIndex: 30, fill: color, fillOpacity: g.discoveredAt ? 0.35 : 0.28, stroke: [{ color, width: 1.6 }], cursor: 'pointer' }
}

/**
 * far: city view, every okrug is an opaque tile of the board.
 * revealed (zoomed in): the okrug being explored is open — basemap and footprints visible.
 * fog (zoomed in): other okrugs stay covered; drawn above plain/game footprints (z 20–30) so only
 * the explored okrug shows details, below the selected footprint (z 40). Game points (DOM) stay on top.
 */
export type DistrictState = 'far' | 'revealed' | 'fog'

export function districtStyle(state: DistrictState, selected: boolean): DrawingStyle {
  if (state === 'revealed') {
    return { zIndex: 5, fill: MAP_COLORS.districtSelected, fillOpacity: 0, stroke: [{ color: MAP_COLORS.districtLine, width: 2 }], cursor: 'pointer' }
  }
  return {
    zIndex: state === 'fog' ? 35 : 5,
    fill: selected ? MAP_COLORS.districtSelected : MAP_COLORS.district,
    fillOpacity: 1,
    stroke: [{ color: MAP_COLORS.districtLine, width: state === 'fog' ? 1.5 : 1 }],
    cursor: 'pointer',
  }
}

/** Circle as a polygon (accuracy halo) — metres → degrees on a local tangent plane. */
function circle(center: LngLatPair, radiusM: number, steps = 40): LngLat[] {
  const [lng, lat] = center
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring: LngLat[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return ring
}

function element(className: string, html = ''): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.innerHTML = html
  return el
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface Drawn<T, E> {
  entity: E
  source: T
  key: string
}

export class YandexMapService implements MapService {
  private api: YmapsApi | null = null
  private map: YMap | null = null
  private listener: YMapListener | null = null
  private scheme: YMapDefaultSchemeLayer | null = null
  private margin: MapInit['margin'] = [0, 0, 0, 0]
  private basemapVisible = false
  private lastViewportKey = ''
  /** okrug under the screen centre, revealed when zoomed in (unless another one is selected) */
  private centerDistrictId: string | null = null
  private destroyed = false
  private zoom = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private basemapTimer: ReturnType<typeof setTimeout> | null = null
  private viewportHandler: ((v: MapViewport) => void) | null = null
  private selectHandler: ((t: MapTarget) => void) | null = null
  private scene: MapScene | null = null

  private readonly outlines = new Map<number, Drawn<BuildingOutline, YMapFeature>>()
  private readonly points = new Map<string, Drawn<MapBuilding, YMapMarker>>()
  private readonly districts = new Map<string, Drawn<DistrictOverview, YMapFeature>>()
  private readonly districtLabels = new Map<string, YMapMarker>()
  private percentPin: { marker: YMapMarker; key: string } | null = null
  private me: { dot: YMapMarker; halo: YMapFeature } | null = null
  private explored: { feature: YMapFeature; cells: readonly Cell[] } | null = null

  constructor(private readonly loadApi: () => Promise<YmapsApi>) {}

  async mount(container: HTMLElement, init: MapInit): Promise<void> {
    const api = await this.loadApi()
    if (this.destroyed) return
    this.api = api
    this.zoom = init.zoom
    this.margin = init.margin
    const map = new api.YMap(container, {
      location: { center: init.center, zoom: init.zoom },
      margin: init.margin,
      zoomRange: { min: MIN_ZOOM, max: 19 },
      restrictMapArea: MAP_AREA,
      // no rotation/tilt: the game board is always north-up and flat
      behaviors: ['drag', 'pinchZoom', 'scrollZoom', 'dblClick', 'oneFingerZoom'],
    })
    this.basemapVisible = init.zoom >= BASEMAP_MIN_ZOOM
    this.scheme = new api.YMapDefaultSchemeLayer({ customization: SCHEME_CUSTOMIZATION, visible: this.basemapVisible })
    map.addChild(this.scheme)
    map.addChild(new api.YMapDefaultFeaturesLayer({}))
    map.addChild(new api.YMapFeatureDataSource({ id: EXPLORED_SOURCE }))
    map.addChild(new api.YMapLayer({ source: EXPLORED_SOURCE, type: 'features', zIndex: EXPLORED_Z_INDEX }))
    this.listener = new api.YMapListener({
      layer: 'any',
      onClick: (object) => this.selectHandler?.(targetOf(object?.entity.properties)),
      onUpdate: ({ location }) => {
        this.setZoom(location.zoom)
        this.scheduleViewport()
      },
    })
    map.addChild(this.listener)
    this.map = map
    this.updateZoomClasses()
    if (this.scene) this.render(this.scene)
    this.scheduleViewport()
  }

  onViewport(handler: (viewport: MapViewport) => void): void {
    this.viewportHandler = handler
  }

  onSelect(handler: (target: MapTarget) => void): void {
    this.selectHandler = handler
  }

  setMargin(margin: MapInit['margin']): void {
    // Yandex fires an update even for an unchanged margin, which would re-emit the viewport
    if (margin.every((v, i) => v === this.margin[i])) return
    this.margin = margin
    this.map?.setMargin(margin)
  }

  flyTo(center: LngLatPair, zoom = 16): void {
    // hide before the flight: Yandex requests tiles for the target zoom as the animation starts
    if (zoom < BASEMAP_MIN_ZOOM) this.setBasemapVisible(false)
    this.map?.setLocation({ center, zoom, duration: 500 })
  }

  fitBounds([[minLng, minLat], [maxLng, maxLat]]: [LngLatPair, LngLatPair], maxZoom = 19, animate = true): void {
    const map = this.map
    if (!map) return
    // fit into the area not covered by overlays (the map centres within its margin)
    const [top, right, bottom, left] = this.margin
    const w = map.size.x - left - right
    const h = map.size.y - top - bottom
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
    const zx = Math.log2((Math.max(w, 1) * 360) / (256 * Math.max(maxLng - minLng, 1e-9)))
    const zy = Math.log2((Math.max(h, 1) * 2 * Math.PI) / (256 * Math.max(mercY(maxLat) - mercY(minLat), 1e-9)))
    const zoom = Math.min(zx, zy, maxZoom) - 0.1
    if (zoom < BASEMAP_MIN_ZOOM) this.setBasemapVisible(false)
    map.setLocation({ center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2], zoom, duration: animate ? 500 : 0 })
  }

  render(scene: MapScene): void {
    this.scene = scene
    if (!this.map || !this.api) return
    this.renderDistricts(scene)
    this.renderOutlines(scene)
    this.renderPoints(scene)
    this.renderPosition(scene)
    this.renderExplored(scene)
  }

  destroy(): void {
    this.destroyed = true
    if (this.settleTimer) clearTimeout(this.settleTimer)
    if (this.basemapTimer) clearTimeout(this.basemapTimer)
    this.settleTimer = null
    this.basemapTimer = null
    this.viewportHandler = null
    this.selectHandler = null
    this.outlines.clear()
    this.points.clear()
    this.districts.clear()
    this.districtLabels.clear()
    this.percentPin = null
    this.me = null
    this.explored = null
    this.listener = null
    this.scheme = null
    this.map?.destroy()
    this.map = null
    this.api = null
    this.scene = null
  }

  /** For tests and diagnostics. */
  get drawnCounts() {
    return { outlines: this.outlines.size, points: this.points.size, districts: this.districts.size }
  }

  private setZoom(zoom: number): void {
    const before = this.zoom
    this.zoom = zoom
    const crossed = (t: number) => before < t !== zoom < t
    if (crossed(POINTS_MIN_ZOOM) || crossed(DISTRICT_LABEL_MAX_ZOOM)) this.updateZoomClasses()
    // hide at once when leaving street level; showing waits for the map to settle (see onSettled)
    if (zoom < BASEMAP_MIN_ZOOM) this.setBasemapVisible(false)
    if (crossed(DISTRICT_NEAR_ZOOM) && this.scene) {
      for (const d of this.districts.values()) d.key = '' // force restyle
      this.renderDistricts(this.scene)
    }
  }

  /** Zoom-dependent visibility of DOM markers is handled in CSS (see MapCanvas.vue). */
  private updateZoomClasses(): void {
    const el = this.map?.container
    if (!el) return
    el.classList.toggle('metka-zoom-far', this.zoom < POINTS_MIN_ZOOM)
    el.classList.toggle('metka-zoom-near', this.zoom >= DISTRICT_LABEL_MAX_ZOOM)
  }

  private setBasemapVisible(visible: boolean): void {
    if (!this.scheme || this.basemapVisible === visible) return
    this.basemapVisible = visible
    this.scheme.update({ visible })
  }

  /**
   * Coming in from the city view, the basemap appears only once the zoom gesture ends: Yandex then
   * fetches tiles for the final zoom and the area zoomed into, not for every intermediate level of
   * the whole city (measured: 48 instead of ~200 tiles). Once visible it stays on while moving.
   */
  private scheduleBasemap(): void {
    if (this.basemapVisible) return
    if (this.basemapTimer) clearTimeout(this.basemapTimer)
    this.basemapTimer = setTimeout(() => {
      this.basemapTimer = null
      if (this.zoom >= BASEMAP_MIN_ZOOM) this.setBasemapVisible(true)
    }, BASEMAP_SETTLE_MS)
  }

  private scheduleViewport(): void {
    this.scheduleBasemap()
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      const map = this.map
      if (!map) return
      this.updateCenterDistrict()
      if (!this.viewportHandler) return
      const bounds: LngLatBounds = map.bounds
      const [a, b] = bounds
      const viewport: MapViewport = {
        bbox: {
          minLng: Math.min(a[0], b[0]),
          minLat: Math.min(a[1], b[1]),
          maxLng: Math.max(a[0], b[0]),
          maxLat: Math.max(a[1], b[1]),
        },
        zoom: map.zoom,
      }
      // updates without camera movement (margin, layer changes) must not trigger data reloads
      const key = [viewport.bbox.minLng, viewport.bbox.minLat, viewport.bbox.maxLng, viewport.bbox.maxLat]
        .map((v) => v.toFixed(6))
        .concat(viewport.zoom.toFixed(2))
        .join(',')
      if (key === this.lastViewportKey) return
      this.lastViewportKey = key
      this.viewportHandler(viewport)
    }, VIEWPORT_SETTLE_MS)
  }

  /**
   * Generic diff: remove what is gone, add what is new, update what changed. Stores replace an
   * object when its data changes, so identity covers geometry; `keyOf` covers selection/zoom state.
   */
  private sync<K, T, E extends YMapFeature | YMapMarker>(
    drawn: Map<K, Drawn<T, E>>,
    next: Map<K, T>,
    keyOf: (item: T) => string,
    create: (item: T) => E,
    update: (entity: E, item: T) => void,
  ): void {
    const map = this.map!
    for (const [id, d] of drawn) {
      if (!next.has(id)) {
        map.removeChild(d.entity)
        drawn.delete(id)
      }
    }
    for (const [id, item] of next) {
      const key = keyOf(item)
      const d = drawn.get(id)
      if (!d) {
        const entity = create(item)
        map.addChild(entity)
        drawn.set(id, { entity, source: item, key })
      } else if (d.source !== item || d.key !== key) {
        update(d.entity, item)
        d.source = item
        d.key = key
      }
    }
  }

  private renderOutlines(scene: MapScene): void {
    const api = this.api!
    const next = new Map(scene.outlines.map((o) => [o.id, o]))
    const keyOf = (o: BuildingOutline) => String(o.id === scene.selectedOutlineId)
    this.sync(
      this.outlines,
      next,
      keyOf,
      (o) =>
        new api.YMapFeature({
          id: `outline-${o.id}`,
          geometry: toYandexGeometry(o.geometry),
          style: outlineStyle(o, o.id === scene.selectedOutlineId),
          properties: { kind: 'outline', id: o.id } satisfies Props,
        }),
      (feature, o) => feature.update({ geometry: toYandexGeometry(o.geometry), style: outlineStyle(o, o.id === scene.selectedOutlineId) }),
    )
  }

  private renderPoints(scene: MapScene): void {
    const api = this.api!
    const visible = scene.buildings.filter((b) => !scene.buildingsWithOutline.has(b.id))
    const next = new Map(visible.map((b) => [b.id, b]))
    const classOf = (b: MapBuilding) =>
      ['metka-point', `metka-point--${b.rarity}`, b.discoveredAt ? 'metka-point--found' : '', b.id === scene.selectedBuildingId ? 'metka-point--selected' : '']
        .filter(Boolean)
        .join(' ')
    this.sync(
      this.points,
      next,
      classOf,
      (b) =>
        new api.YMapMarker(
          { id: `point-${b.id}`, coordinates: [b.lng, b.lat], properties: { kind: 'building', id: b.id } satisfies Props, hideOutsideViewport: true },
          element(classOf(b)),
        ),
      (marker, b) => {
        marker.update({ coordinates: [b.lng, b.lat] })
        const el = marker.element
        if (el) el.className = classOf(b)
      },
    )
  }

  private updateCenterDistrict(): void {
    const map = this.map
    if (!map || !this.scene) return
    const [lng, lat] = map.center
    const id = this.scene.districts.find((d) => containsPoint(d.boundary, [lng, lat]))?.id ?? null
    if (id === this.centerDistrictId) return
    this.centerDistrictId = id
    this.renderDistricts(this.scene)
  }

  private renderDistricts(scene: MapScene): void {
    const api = this.api!
    const near = this.zoom >= DISTRICT_NEAR_ZOOM
    const revealedId = scene.selectedDistrictId ?? this.centerDistrictId
    const stateOf = (d: DistrictOverview): DistrictState => (!near ? 'far' : d.id === revealedId ? 'revealed' : 'fog')
    const styleOf = (d: DistrictOverview) => districtStyle(stateOf(d), d.id === scene.selectedDistrictId)
    const next = new Map(scene.districts.map((d) => [d.id, d]))
    this.sync(
      this.districts,
      next,
      (d) => `${d.id === scene.selectedDistrictId}|${stateOf(d)}`,
      (d) =>
        new api.YMapFeature({
          id: `district-${d.id}`,
          geometry: toYandexGeometry(d.boundary),
          style: styleOf(d),
          properties: { kind: 'district', id: d.id } satisfies Props,
        }),
      (feature, d) => feature.update({ geometry: toYandexGeometry(d.boundary), style: styleOf(d) }),
    )

    // labels: created once per district, hidden by CSS when zoomed in
    for (const [id, marker] of this.districtLabels) {
      if (!next.has(id)) {
        this.map!.removeChild(marker)
        this.districtLabels.delete(id)
      }
    }
    for (const d of scene.districts) {
      const point = labelPoint(d.boundary)
      if (!point || this.districtLabels.has(d.id)) continue
      const marker = new api.YMapMarker(
        { id: `district-label-${d.id}`, coordinates: point, properties: { kind: 'district', id: d.id } satisfies Props },
        element('metka-district-label', escapeHtml(d.shortName)),
      )
      this.map!.addChild(marker)
      this.districtLabels.set(d.id, marker)
    }

    // "58%" pin over the selected district
    const selected = scene.districts.find((d) => d.id === scene.selectedDistrictId)
    const point = selected ? labelPoint(selected.boundary) : null
    const percent = selected && selected.totalBuildings > 0 ? Math.round((100 * selected.discoveredBuildings) / selected.totalBuildings) : 0
    const key = selected && point ? `${selected.id}|${percent}` : ''
    if (this.percentPin?.key === key) return
    if (this.percentPin) this.map!.removeChild(this.percentPin.marker)
    this.percentPin = null
    if (!selected || !point) return
    const pin = element('metka-percent-pin', `<span class="metka-percent-pin__value">${percent}%</span>`)
    pin.setAttribute('aria-label', `Изучено ${percent}%`)
    const marker = new api.YMapMarker({ coordinates: point, zIndex: 100 }, pin)
    this.map!.addChild(marker)
    this.percentPin = { marker, key }
  }

  private renderExplored(scene: MapScene): void {
    const cells = scene.exploredCells
    if (this.explored?.cells === cells) return
    if (this.explored && cells.length === 0) {
      this.map!.removeChild(this.explored.feature)
      this.explored = null
      return
    }
    if (cells.length === 0) return
    const geometry = toYandexGeometry(cellsToMultiPolygon(cells))
    if (this.explored) {
      this.explored.feature.update({ geometry })
      this.explored.cells = cells
      return
    }
    const feature = new this.api!.YMapFeature({
      id: 'explored',
      source: EXPLORED_SOURCE,
      geometry,
      style: { fill: MAP_COLORS.accent, fillOpacity: 0.28, stroke: [{ width: 0 }], interactive: false },
    })
    this.map!.addChild(feature)
    this.explored = { feature, cells }
  }

  private renderPosition(scene: MapScene): void {
    const api = this.api!
    const p = scene.position
    if (!p) {
      if (this.me) {
        this.map!.removeChild(this.me.dot)
        this.map!.removeChild(this.me.halo)
        this.me = null
      }
      return
    }
    const center: LngLatPair = [p.lng, p.lat]
    const halo = { type: 'Polygon' as const, coordinates: [circle(center, Math.max(p.accuracyM, 5))] }
    if (!this.me) {
      this.me = {
        halo: new api.YMapFeature({
          geometry: halo,
          style: { zIndex: 50, fill: MAP_COLORS.accent, fillOpacity: 0.14, stroke: [{ width: 0 }], interactive: false },
        }),
        dot: new api.YMapMarker({ coordinates: center, zIndex: 200 }, element('metka-me')),
      }
      this.map!.addChild(this.me.halo)
      this.map!.addChild(this.me.dot)
    } else {
      this.me.halo.update({ geometry: halo })
      this.me.dot.update({ coordinates: center })
    }
  }
}
