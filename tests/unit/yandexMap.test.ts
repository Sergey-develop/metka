import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapLoadError, type MapScene, type MapTarget, type MapViewport } from '@/services/map/types'
import { loadYandexMaps, resetYandexLoader, type YmapsApi } from '@/services/map/yandexLoader'
import { cellKey, cellOf } from '@/services/exploration/grid'
import { outlineStyle, revealedBy, targetOf, toYandexGeometry, YandexMapService } from '@/services/map/yandexMap'
import type { BuildingOutline, DistrictOverview, OutlineGameInfo } from '@/types/game'
import { BUILDING } from './helpers'

type AnyProps = Record<string, unknown>

class FakeEntity {
  props: AnyProps
  updates = 0
  constructor(props: AnyProps) {
    this.props = { ...props }
  }
  update(p: AnyProps) {
    this.updates++
    Object.assign(this.props, p)
  }
  get properties() {
    return this.props.properties as AnyProps | undefined
  }
}
class FakeFeature extends FakeEntity {}
class FakeMarker extends FakeEntity {
  constructor(
    props: AnyProps,
    readonly element: HTMLElement = document.createElement('div'),
  ) {
    super(props)
  }
}
class FakeListener extends FakeEntity {}
class FakeLayer extends FakeEntity {}
class FakeDataSource extends FakeEntity {}
class FakeCustomLayer extends FakeEntity {}

let lastMap: FakeMap | null = null
class FakeMap {
  children = new Set<FakeEntity>()
  destroyed = false
  zoom = 16
  size = { x: 400, y: 800 }
  // top-left, bottom-right
  bounds: [[number, number], [number, number]] = [
    [37.61, 55.66],
    [37.63, 55.65],
  ]
  /** inside DISTRICT */
  center: [number, number] = [37.6005, 55.6505]
  setLocation = vi.fn()
  setMargin = vi.fn()
  constructor(
    readonly container: HTMLElement,
    readonly props: AnyProps,
  ) {
    lastMap = this
  }
  addChild(c: FakeEntity) {
    this.children.add(c)
  }
  removeChild(c: FakeEntity) {
    this.children.delete(c)
  }
  destroy() {
    this.destroyed = true
  }
  of<T>(cls: new (...a: never[]) => T): T[] {
    return [...this.children].filter((c): c is FakeEntity & T => c instanceof cls)
  }
}

const fakeApi = {
  ready: Promise.resolve(),
  YMap: FakeMap,
  YMapFeature: FakeFeature,
  YMapMarker: FakeMarker,
  YMapListener: FakeListener,
  YMapDefaultSchemeLayer: FakeLayer,
  YMapDefaultFeaturesLayer: FakeLayer,
  YMapFeatureDataSource: FakeDataSource,
  YMapLayer: FakeCustomLayer,
} as unknown as YmapsApi

const square = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 55.65], [x + 0.001, 55.65], [x + 0.001, 55.651], [x, 55.65]]],
})

const GAME: OutlineGameInfo = {
  id: BUILDING.id,
  status: 'published',
  name: 'ГУМ',
  description: null,
  category: null,
  rarity: 'rare',
  imageUrl: null,
  discoveredAt: null,
}

function outline(id: number, game: OutlineGameInfo | null = null): BuildingOutline {
  return { id, osmType: 'way', osmId: id, geometry: square(37.61 + id * 0.001), name: null, address: null, category: null, game }
}

const DISTRICT: DistrictOverview = {
  id: 'd1',
  slug: 'cao',
  name: 'Центральный',
  shortName: 'ЦАО',
  boundary: { type: 'MultiPolygon', coordinates: [square(37.6).coordinates] },
  totalBuildings: 4,
  discoveredBuildings: 1,
} as DistrictOverview

function scene(over: Partial<MapScene> = {}): MapScene {
  return {
    districts: [DISTRICT],
    selectedDistrictId: null,
    buildings: [BUILDING],
    selectedBuildingId: null,
    buildingsWithOutline: new Set(),
    outlines: [outline(1), outline(2)],
    selectedOutlineId: null,
    position: null,
    exploredCells: [],
    recentCells: [],
    fog: false,
    route: null,
    ...over,
  }
}

async function mounted() {
  const service = new YandexMapService(async () => fakeApi)
  await service.mount(document.createElement('div'), { center: [37.62, 55.655], zoom: 16, margin: [100, 8, 120, 8] })
  return { service, map: lastMap! }
}

const listenerOf = (map: FakeMap) => map.of(FakeListener)[0]!.props as {
  onClick: (object: { entity: { properties?: AnyProps } } | undefined) => void
  onUpdate: (o: { location: { zoom: number } }) => void
}

describe('YandexMapService', () => {
  beforeEach(() => {
    lastMap = null
  })
  afterEach(() => vi.useRealTimers())

  it('mounts the basemap, the features layer and one listener; north-up without rotation', async () => {
    const { map } = await mounted()
    expect(map.of(FakeLayer)).toHaveLength(2)
    expect(map.of(FakeListener)).toHaveLength(1)
    expect(map.props.margin).toEqual([100, 8, 120, 8])
    expect(map.props.behaviors).not.toContain('mouseRotate')
    expect(map.props.behaviors).not.toContain('pinchRotate')
  })

  it('draws outlines, districts, labels and points; hides points of buildings drawn as footprints', async () => {
    const { service, map } = await mounted()
    service.render(scene())
    expect(service.drawnCounts).toEqual({ outlines: 2, points: 1, districts: 1 })
    service.render(scene({ outlines: [outline(1), outline(2), outline(3, GAME)], buildingsWithOutline: new Set([BUILDING.id]) }))
    expect(service.drawnCounts).toEqual({ outlines: 3, points: 0, districts: 1 })
    const markers = map.of(FakeMarker).map((m) => m.element.className)
    expect(markers).toContain('metka-district-label')
    expect(markers.some((c) => c.startsWith('metka-point'))).toBe(false)
  })

  it('removes layers that left the scene and restyles only what changed', async () => {
    const { service, map } = await mounted()
    const s = scene()
    service.render(s)
    const features = () => map.of(FakeFeature).filter((f) => String(f.props.id).startsWith('outline-'))
    const [first, second] = features()
    service.render({ ...s, selectedOutlineId: 2 })
    expect(first!.updates).toBe(0)
    expect(second!.updates).toBe(1)
    expect((second!.props.style as { stroke: { width: number }[] }).stroke[0]!.width).toBe(3)

    service.render({ ...s, outlines: [s.outlines[0]!] })
    expect(features()).toHaveLength(1)
    service.render({ ...s, outlines: [], districts: [], buildings: [] })
    expect(map.of(FakeFeature)).toHaveLength(0)
    expect(map.of(FakeMarker)).toHaveLength(0) // district label removed with its district
  })

  it('styles game states distinctly from plain buildings', () => {
    const plain = outlineStyle(outline(1), false)
    const game = outlineStyle(outline(1, GAME), false)
    const found = outlineStyle(outline(1, { ...GAME, discoveredAt: '2026-10-18' }), false)
    const unavailable = outlineStyle(outline(1, { ...GAME, status: 'unavailable' }), false)
    const selected = outlineStyle(outline(1, GAME), true)
    expect(plain.stroke![0]!.width).toBeLessThan(1) // thin: never hides streets or labels
    expect(plain.fillOpacity).toBeLessThan(0.05)
    expect(new Set([plain.fill, game.fill, found.fill, unavailable.fill, selected.fill]).size).toBe(5)
    expect(unavailable.stroke![0]!.dash).toBeDefined()
    expect(selected.zIndex!).toBeGreaterThan(game.zIndex!)
  })

  it('reports taps on footprints, points and districts; empty map → null', async () => {
    const { service, map } = await mounted()
    const targets: MapTarget[] = []
    service.onSelect((t) => targets.push(t))
    const { onClick } = listenerOf(map)
    onClick({ entity: { properties: { kind: 'outline', id: 7 } } })
    onClick({ entity: { properties: { kind: 'building', id: 'b1' } } })
    onClick({ entity: { properties: { kind: 'district', id: 'd1' } } })
    onClick({ entity: { properties: { kind: 'outline', id: '7' } } }) // malformed
    onClick(undefined)
    expect(targets).toEqual([{ kind: 'outline', id: 7 }, { kind: 'building', id: 'b1' }, { kind: 'district', id: 'd1' }, null, null])
    expect(targetOf(undefined)).toBeNull()
  })

  it('emits one normalised viewport after the map settles, not per animation frame', async () => {
    vi.useFakeTimers()
    const { service, map } = await mounted()
    const seen: MapViewport[] = []
    service.onViewport((v) => seen.push(v))
    const { onUpdate } = listenerOf(map)
    for (let i = 0; i < 30; i++) onUpdate({ location: { zoom: 16 } })
    vi.advanceTimersByTime(150)
    expect(seen).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(seen).toEqual([{ bbox: { minLng: 37.61, minLat: 55.65, maxLng: 37.63, maxLat: 55.66 }, zoom: 16 }])
  })

  it('shows a flat board at city zoom: basemap hidden, opaque districts; basemap appears when zooming in', async () => {
    const { service, map } = await mounted() // mounted at z16
    const scheme = map.of(FakeLayer)[0]!
    expect(scheme.props.visible).toBe(true)
    // restrictMapArea is [south-west, north-east] (top-left order misplaces the centre — checked in Chrome)
    const [[w, south], [e, north]] = map.props.restrictMapArea as [[number, number], [number, number]]
    expect(south).toBeLessThan(north)
    expect(w).toBeLessThan(e)
    vi.useFakeTimers()
    service.render(scene())
    listenerOf(map).onUpdate({ location: { zoom: 16 } })
    vi.advanceTimersByTime(300) // settle: the okrug under the centre is revealed
    const district = () => map.of(FakeFeature).find((f) => String(f.props.id).startsWith('district-'))!
    expect((district().props.style as { fillOpacity: number }).fillOpacity).toBe(0)

    const { onUpdate } = listenerOf(map)
    onUpdate({ location: { zoom: 10 } })
    expect(scheme.props.visible).toBe(false) // hidden at once
    expect((district().props.style as { fillOpacity: number }).fillOpacity).toBe(1)
    // zooming in: not shown mid-gesture (would load intermediate tiles of the whole city)...
    for (const zoom of [11, 12, 13, 14]) {
      onUpdate({ location: { zoom } })
      vi.advanceTimersByTime(300)
    }
    expect(scheme.props.visible).toBe(false)
    // ...only once the map has settled
    vi.advanceTimersByTime(200)
    expect(scheme.props.visible).toBe(true)
    // flying out to the city view hides it before the animation starts
    service.flyTo([37.6, 55.75], 10)
    expect(scheme.props.visible).toBe(false)
    vi.useRealTimers()

    const far = new YandexMapService(async () => fakeApi)
    await far.mount(document.createElement('div'), { center: [37.6, 55.7], zoom: 10, margin: [0, 0, 0, 0] })
    expect(lastMap!.of(FakeLayer)[0]!.props.visible).toBe(false)
  })

  it('does not re-emit the same viewport (e.g. after an unchanged margin or a layer update)', async () => {
    vi.useFakeTimers()
    const { service, map } = await mounted()
    const seen = vi.fn()
    service.onViewport(seen)
    const { onUpdate } = listenerOf(map)
    onUpdate({ location: { zoom: 16 } })
    vi.advanceTimersByTime(300)
    onUpdate({ location: { zoom: 16 } }) // same camera
    vi.advanceTimersByTime(300)
    expect(seen).toHaveBeenCalledTimes(1)
    service.setMargin([100, 8, 120, 8]) // unchanged
    expect(map.setMargin).not.toHaveBeenCalled()
    map.bounds = [
      [37.62, 55.66],
      [37.64, 55.65],
    ]
    onUpdate({ location: { zoom: 16 } })
    vi.advanceTimersByTime(300)
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('zoomed in, reveals only the okrug being explored; the others stay covered above footprints', async () => {
    vi.useFakeTimers()
    const { service, map } = await mounted()
    const other: DistrictOverview = { ...DISTRICT, id: 'd2', shortName: 'ЮАО', boundary: { type: 'MultiPolygon', coordinates: [square(37.62).coordinates] } }
    const s = scene({ districts: [DISTRICT, other], outlines: [outline(1, GAME)] })
    service.render(s)
    vi.advanceTimersByTime(300)
    const style = (id: string) => map.of(FakeFeature).find((f) => f.props.id === `district-${id}`)!.props.style as { fillOpacity: number; zIndex: number }
    const footprint = map.of(FakeFeature).find((f) => String(f.props.id).startsWith('outline-'))!.props.style as { zIndex: number }
    expect(style('d1').fillOpacity).toBe(0) // centre is inside d1
    expect(style('d2').fillOpacity).toBe(1)
    expect(style('d2').zIndex).toBeGreaterThan(footprint.zIndex) // covers footprints outside the explored okrug

    // pan into d2: after the map settles, d2 opens and d1 is covered
    map.center = [37.6205, 55.6505]
    map.bounds = [
      [37.61, 55.66],
      [37.64, 55.64],
    ]
    listenerOf(map).onUpdate({ location: { zoom: 16 } })
    vi.advanceTimersByTime(300)
    expect(style('d1').fillOpacity).toBe(1)
    expect(style('d2').fillOpacity).toBe(0)

    // a tapped (selected) okrug is the revealed one regardless of the centre
    service.render({ ...s, selectedDistrictId: 'd1' })
    expect(style('d1').fillOpacity).toBe(0)
    expect(style('d2').fillOpacity).toBe(1)
  })

  it('draws explored cells in their own layer above the basemap, below our features, not catching taps', async () => {
    const { service, map } = await mounted()
    const source = map.of(FakeDataSource)[0]!
    const layer = map.of(FakeCustomLayer)[0]!
    expect(layer.props).toMatchObject({ source: source.props.id, type: 'features' })
    // above the basemap sublayers (ground 1000 … labels 1300: slotting between them hides labels),
    // below our features layer (1500) so fog, footprints and markers stay on top
    expect(layer.props.zIndex as number).toBeGreaterThan(1300)
    expect(layer.props.zIndex as number).toBeLessThan(1500)

    const explored = () => map.of(FakeFeature).find((f) => f.props.id === 'explored')
    const cells = [
      [728267, 604988],
      [728267, 604989],
    ] as const
    service.render(scene({ exploredCells: cells }))
    expect(explored()!.props.source).toBe(source.props.id)
    expect((explored()!.props.style as { interactive: boolean }).interactive).toBe(false)
    expect((explored()!.props.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(1) // merged run
    service.render(scene({ exploredCells: [] }))
    expect(explored()).toBeUndefined()
  })

  it('Fog of War: one fog feature above our features, explored cells are holes, the player stays on top', async () => {
    vi.useFakeTimers()
    const { service, map } = await mounted()
    const layers = map.of(FakeCustomLayer).map((l) => l.props as { source: string; type: string; zIndex: number })
    const fogLayer = layers.find((l) => l.source === 'metka-fog')!
    const topMarkers = layers.find((l) => l.type === 'markers')!
    // measured in headless Edge: 1550 covers basemap labels and the default features layer (1500)
    expect(fogLayer).toMatchObject({ type: 'features', zIndex: 1550 })
    expect(topMarkers.zIndex).toBeGreaterThan(fogLayer.zIndex)
    const fog = () => map.of(FakeFeature).find((f) => f.props.id === 'fog')
    const cells = [
      [1456534, 1208997],
      [1456534, 1208998],
    ] as const
    const position = { lat: 55.6534, lng: 37.6196, accuracyM: 10, timestamp: 0 }
    service.render(scene({ fog: true, exploredCells: cells, position }))
    const f = fog()!
    expect(f.props.source).toBe('metka-fog')
    const coords = (f.props.geometry as { coordinates: unknown[][] }).coordinates
    // one fog polygon per game area: Moscow with one merged hole, Zavidovo untouched
    expect(coords).toHaveLength(2)
    expect(coords[0]).toHaveLength(2)
    expect(coords[1]).toEqual([[[36.48, 56.52], [36.58, 56.52], [36.58, 56.62], [36.48, 56.62], [36.48, 56.52]]])
    // no tint over explored land when the fog is on
    expect(map.of(FakeFeature).some((x) => x.props.id === 'explored')).toBe(false)
    // tapping the fog selects nothing (footprints under it cannot be opened)
    expect(targetOf(f.properties)).toBeNull()
    // the player: dot in the top markers layer, halo in the top features layer
    const dot = map.of(FakeMarker).find((m) => m.element.className === 'metka-me')!
    expect(dot.props.source).toBe(topMarkers.source)
    expect(map.of(FakeFeature).some((x) => x.props.source === 'metka-top')).toBe(true)

    // same cells → no rebuild; new cells → one update of the same feature
    service.render(scene({ fog: true, exploredCells: cells, position: { ...position, accuracyM: 12 } }))
    expect(f.updates).toBe(0)
    service.render(scene({ fog: true, exploredCells: [...cells, [1456535, 1208997]], position }))
    expect(f.updates).toBe(1)
    expect(fog()).toBe(f)

    // city view: the okrug board instead of fog; back at street level the fog returns
    const { onUpdate } = listenerOf(map)
    onUpdate({ location: { zoom: 10 } })
    expect(fog()).toBeUndefined()
    onUpdate({ location: { zoom: 15 } })
    vi.advanceTimersByTime(1000)
    expect(fog()).toBeDefined()

    service.render(scene({ fog: false, exploredCells: cells }))
    expect(fog()).toBeUndefined()
    expect(map.of(FakeFeature).some((x) => x.props.id === 'explored')).toBe(true)
  })

  it('fog is milky white, 72 % opaque; its only edge effect is a soft mist in the fog colour that follows the zoom', async () => {
    const { service, map } = await mounted()
    service.render(scene({ fog: true, exploredCells: [[1456534, 1208997]] }))
    const fog = map.of(FakeFeature).find((f) => f.props.id === 'fog')!
    const feather = map.of(FakeFeature).find((f) => f.props.id === 'fog-feather')!
    const style = fog.props.style as { fillOpacity: number; stroke: { width: number }[] }
    expect(style.fillOpacity).toBe(0.72)
    expect((fog.props.style as { fill: string }).fill).toBe('#F3F5F8')
    expect(style.stroke.every((s) => s.width === 0)).toBe(true)
    // nothing but the fog and its mist in the fog layer; the mist is fog-coloured (no frame, no glow)
    expect(map.of(FakeFeature).filter((f) => f.props.source === fog.props.source)).toEqual([fog, feather])
    const strokes = (feather.props.style as { interactive: boolean; stroke: { color: string; width: number; opacity: number }[] })
    expect(strokes.interactive).toBe(false)
    expect(new Set(strokes.stroke.map((s) => s.color))).toEqual(new Set([(fog.props.style as { fill: string }).fill]))
    expect(strokes.stroke.every((s) => s.opacity < 0.5)).toBe(true)
    // graded: several strokes, the narrower on top, so the mist thins out away from the border
    expect(strokes.stroke.length).toBeGreaterThanOrEqual(5)
    const widths = strokes.stroke.map((s) => s.width)
    expect(widths).toEqual([...widths].sort((a, b) => b - a))
    // the mist keeps its size on the ground: wider strokes when zoomed in; geometry is not rebuilt
    const width = () => Math.max(...(feather.props.style as { stroke: { width: number }[] }).stroke.map((s) => s.width))
    const at16 = width()
    const geometryUpdates = fog.updates
    listenerOf(map).onUpdate({ location: { zoom: 17 } })
    expect(width()).toBeGreaterThan(at16)
    expect(fog.updates).toBe(geometryUpdates)
  })

  it('with the fog on, taps never select footprints or game points on unexplored land', async () => {
    const { service, map } = await mounted()
    const picked: MapTarget[] = []
    service.onSelect((t) => picked.push(t))
    const { onClick } = listenerOf(map)
    // outline(1) lies at lng 37.611…37.612, lat 55.650…55.651; BUILDING is the game point
    const [y, x] = cellOf(55.65, 37.611)
    service.render(scene({ fog: true, exploredCells: [] }))
    onClick({ entity: { properties: { kind: 'outline', id: 1 } } })
    onClick({ entity: { properties: { kind: 'building', id: BUILDING.id } } })
    onClick({ entity: { properties: { kind: 'district', id: 'd1' } } })
    onClick({ entity: { properties: { kind: 'fog' } } })
    expect(picked).toEqual([null, null, { kind: 'district', id: 'd1' }, null])
    picked.length = 0
    service.render(scene({ fog: true, exploredCells: [[y, x]] })) // one corner of the footprint explored
    onClick({ entity: { properties: { kind: 'outline', id: 1 } } })
    onClick({ entity: { properties: { kind: 'outline', id: 2 } } }) // still in the fog
    expect(picked).toEqual([{ kind: 'outline', id: 1 }, null])
    picked.length = 0
    service.render(scene({ fog: false, exploredCells: [] })) // fog lifted (admin)
    onClick({ entity: { properties: { kind: 'outline', id: 2 } } })
    expect(picked).toEqual([{ kind: 'outline', id: 2 }])
  })

  it('revealedBy: any vertex of a footprint, or the point itself, in an explored cell', () => {
    const [y, x] = cellOf(55.65, 37.611)
    const explored = new Set([cellKey([y, x])])
    expect(revealedBy(square(37.611), explored)).toBe(true)
    expect(revealedBy(square(37.62), explored)).toBe(false)
    expect(revealedBy({ type: 'Point', coordinates: [37.611, 55.65] }, explored)).toBe(true)
    expect(revealedBy({ type: 'Point', coordinates: [37.62, 55.65] }, explored)).toBe(false)
  })

  it('toggles zoom classes for DOM markers', async () => {
    const { map } = await mounted()
    const { onUpdate } = listenerOf(map)
    onUpdate({ location: { zoom: 10 } })
    expect(map.container.classList.contains('metka-zoom-far')).toBe(true)
    onUpdate({ location: { zoom: 14 } })
    expect(map.container.classList.contains('metka-zoom-far')).toBe(false)
    expect(map.container.classList.contains('metka-zoom-near')).toBe(true)
  })

  it('destroy releases the map, timers and handlers', async () => {
    vi.useFakeTimers()
    const { service, map } = await mounted()
    const seen = vi.fn()
    service.onViewport(seen)
    service.render(scene())
    listenerOf(map).onUpdate({ location: { zoom: 16 } })
    service.destroy()
    vi.advanceTimersByTime(1000)
    expect(seen).not.toHaveBeenCalled()
    expect(map.destroyed).toBe(true)
    expect(service.drawnCounts).toEqual({ outlines: 0, points: 0, districts: 0 })
    service.render(scene()) // no-op, no throw
  })

  it('does not create a map if destroyed while the API is loading', async () => {
    let release: (api: YmapsApi) => void = () => undefined
    const service = new YandexMapService(() => new Promise((r) => (release = r)))
    const mounting = service.mount(document.createElement('div'), { center: [0, 0], zoom: 10, margin: [0, 0, 0, 0] })
    service.destroy()
    release(fakeApi)
    await mounting
    expect(lastMap).toBeNull()
  })

  it('draws the player position as a dot with an accuracy halo', async () => {
    const { service, map } = await mounted()
    service.render(scene({ position: { lat: 55.655, lng: 37.62, accuracyM: 20, timestamp: 0 } }))
    expect(map.of(FakeMarker).some((m) => m.element.className === 'metka-me')).toBe(true)
    service.render(scene({ position: null }))
    expect(map.of(FakeMarker).some((m) => m.element.className === 'metka-me')).toBe(false)
  })

  it('draws the walking route above the fog with a destination pin; a new array updates it, null removes it', async () => {
    const { service, map } = await mounted()
    const routeLine = () => map.of(FakeFeature).find((f) => f.props.id === 'route')
    const endPin = () => map.of(FakeMarker).find((m) => m.element.className === 'metka-route-end')
    service.render(scene({ fog: true, route: [[37.62, 55.655], [37.621, 55.656], [37.622, 55.657]] }))
    expect(routeLine()?.props.source).toBe('metka-top')
    expect((routeLine()?.props.geometry as { type: string }).type).toBe('LineString')
    expect(endPin()?.props.coordinates).toEqual([37.622, 55.657])
    const line = routeLine()
    service.render(scene({ fog: true, route: [[37.62, 55.655], [37.623, 55.658]] }))
    expect(routeLine()).toBe(line)
    expect(endPin()?.props.coordinates).toEqual([37.623, 55.658])
    service.render(scene({ fog: true, route: null }))
    expect(routeLine()).toBeUndefined()
    expect(endPin()).toBeUndefined()
  })

  it('converts GeoJSON geometry to Yandex [lng, lat] tuples', () => {
    expect(toYandexGeometry({ type: 'Point', coordinates: [37.6, 55.7, 120] })).toEqual({ type: 'Point', coordinates: [37.6, 55.7] })
    expect(toYandexGeometry(DISTRICT.boundary).type).toBe('MultiPolygon')
  })
})

describe('loadYandexMaps', () => {
  interface FakeScript {
    src: string
    async: boolean
    onload: (() => void) | null
    onerror: (() => void) | null
    removed: boolean
    remove(): void
  }
  let scripts: FakeScript[]
  const doc = () =>
    ({
      createElement: () => {
        const script: FakeScript = { src: '', async: false, onload: null, onerror: null, removed: false, remove: () => (script.removed = true) }
        scripts.push(script)
        return script
      },
      head: { append: () => undefined },
    }) as unknown as Document

  beforeEach(() => {
    scripts = []
    resetYandexLoader()
    delete (globalThis as { ymaps3?: unknown }).ymaps3
  })
  afterEach(() => {
    delete (globalThis as { ymaps3?: unknown }).ymaps3
  })

  it('injects the script once with the key and resolves when the API is ready', async () => {
    const d = doc()
    const a = loadYandexMaps('k-1', d)
    const b = loadYandexMaps('k-1', d)
    expect(a).toBe(b)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.src).toBe('https://api-maps.yandex.ru/v3/?apikey=k-1&lang=ru_RU')
    ;(globalThis as { ymaps3?: unknown }).ymaps3 = fakeApi
    scripts[0]!.onload!()
    await expect(a).resolves.toBe(fakeApi)
    await expect(loadYandexMaps('k-1', d)).resolves.toBe(fakeApi) // already loaded: no new script
    expect(scripts).toHaveLength(1)
  })

  it('rejects with MapLoadError on a rejected key / network error and allows a retry', async () => {
    const d = doc()
    const first = loadYandexMaps('bad', d)
    scripts[0]!.onerror!()
    await expect(first).rejects.toBeInstanceOf(MapLoadError)
    expect(scripts[0]!.removed).toBe(true)
    const second = loadYandexMaps('bad', d)
    expect(scripts).toHaveLength(2)
    scripts[1]!.onerror!()
    await expect(second).rejects.toThrow('script_failed')
  })

  it('times out when the API never becomes ready', async () => {
    vi.useFakeTimers()
    const pending = loadYandexMaps('k', doc())
    const check = expect(pending).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(20_000)
    await check
    vi.useRealTimers()
  })
})

describe('containsPoint', () => {
  it('respects holes', async () => {
    const { containsPoint } = await import('@/utils/mapGeometry')
    const donut: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]],
    }
    expect(containsPoint(donut, [1, 1])).toBe(true)
    expect(containsPoint(donut, [5, 5])).toBe(false)
    expect(containsPoint(donut, [11, 5])).toBe(false)
  })
})
