import type { Cell } from '@/services/exploration/grid'
import type { GeoFix } from '@/services/geolocation/types'
import type { Bbox, BuildingOutline, DistrictOverview, MapBuilding } from '@/types/game'

export type LngLatPair = [lng: number, lat: number]

/** From this zoom the basemap (and the Fog of War over it) is shown; below it is the okrug board. */
export const STREET_LEVEL_ZOOM = 11.5

/** What the player tapped on the map; null = empty map. */
export type MapTarget =
  | { kind: 'outline'; id: number }
  | { kind: 'building'; id: string }
  | { kind: 'district'; id: string }
  | null

export interface MapViewport {
  bbox: Bbox
  zoom: number
}

export interface MapInit {
  center: LngLatPair
  zoom: number
  /** px covered by UI overlays: [top, right, bottom, left] */
  margin: [number, number, number, number]
}

export interface MapScene {
  districts: DistrictOverview[]
  selectedDistrictId: string | null
  /** game buildings drawn as points (layer C fallback when no footprint is loaded) */
  buildings: MapBuilding[]
  selectedBuildingId: string | null
  /** game building ids that already have a footprint on the map: no point for them */
  buildingsWithOutline: ReadonlySet<string>
  outlines: BuildingOutline[]
  selectedOutlineId: number | null
  position: GeoFix | null
  /** explored territory cells; drawn under basemap labels and above its buildings */
  exploredCells: readonly Cell[]
  /** cells revealed a moment ago (subset of exploredCells), highlighted briefly */
  recentCells: readonly Cell[]
  /** Fog of War: hide unexplored land at street level (exploredCells are the holes) */
  fog: boolean
}

/**
 * The game's view of a map engine (ADR-003). Vue components talk only to this;
 * the Yandex implementation lives in yandexMap.ts.
 */
export interface MapService {
  /** Resolves once the basemap is ready; rejects with MapLoadError. */
  mount(container: HTMLElement, init: MapInit): Promise<void>
  /** Declarative: diffed against what is drawn; cheap to call on every change. */
  render(scene: MapScene): void
  /** Called after the map settles (not on every animation frame). */
  onViewport(handler: (viewport: MapViewport) => void): void
  onSelect(handler: (target: MapTarget) => void): void
  setMargin(margin: MapInit['margin']): void
  flyTo(center: LngLatPair, zoom?: number): void
  fitBounds(bounds: [LngLatPair, LngLatPair], maxZoom?: number, animate?: boolean): void
  /** Removes every layer, listener and timer; the instance is unusable afterwards. */
  destroy(): void
}

export class MapLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MapLoadError'
  }
}
