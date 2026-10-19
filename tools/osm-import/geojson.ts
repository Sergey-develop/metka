/**
 * Validation and normalisation of OpenStreetMap building GeoJSON before import.
 * Accepts the output of overpass-turbo export, osmtogeojson and tools/osm-import/overpass.ts.
 * Pure: no I/O, so it is unit-tested directly. The server re-validates geometry.
 */

export type OsmType = 'node' | 'way' | 'relation'
export type Position = [number, number]
export type BuildingGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: 'Point'; coordinates: Position }

/** Payload item of the import_osm_buildings RPC. */
export interface OsmBuildingInput {
  osmType: OsmType
  osmId: number
  geometry: BuildingGeometry
  name: string | null
  address: string | null
  category: string | null
  tags: Record<string, string>
}

export type SkipReason =
  | 'invalid_id'
  | 'not_building'
  | 'invalid_geometry'
  | 'invalid_coordinates'
  | 'duplicate_id'
  | 'duplicate_geometry'

export interface SkippedFeature {
  index: number
  ref: string | null
  reason: SkipReason
}

export interface ParseResult {
  features: OsmBuildingInput[]
  skipped: SkippedFeature[]
}

export class GeoJsonFormatError extends Error {}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// no constructor parameter properties: the CLI runs under node --experimental-strip-types
class SkipError extends Error {
  readonly reason: SkipReason
  constructor(reason: SkipReason) {
    super(reason)
    this.reason = reason
  }
}

function parseRef(value: unknown): { osmType: OsmType; osmId: number } | null {
  if (typeof value !== 'string') return null
  const m = /^(node|way|relation)\/([1-9]\d{0,15})$/.exec(value.trim())
  if (!m) return null
  const osmId = Number(m[2])
  return Number.isSafeInteger(osmId) ? { osmType: m[1] as OsmType, osmId } : null
}

function featureRef(feature: Json, props: Json): { osmType: OsmType; osmId: number } | null {
  return (
    parseRef(feature.id) ??
    parseRef(props['@id']) ??
    parseRef(props.id) ??
    (typeof props.type === 'string' ? parseRef(`${props.type}/${String(props.id)}`) : null)
  )
}

/** osmtogeojson nests tags; overpass-turbo flattens them next to "@id"-style metadata. */
function featureTags(props: Json): Record<string, string> {
  const source = isObject(props.tags) ? props.tags : props
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) {
    if (source === props && (k.startsWith('@') || k === 'id' || k === 'type')) continue
    if (typeof v === 'string' && k.length <= 255 && v.length <= 255) tags[k] = v
  }
  return tags
}

function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length < 2) throw new SkipError('invalid_geometry')
  const [lng, lat] = value
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat))
    throw new SkipError('invalid_coordinates')
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new SkipError('invalid_coordinates')
  return [lng, lat]
}

function ring(value: unknown): Position[] {
  if (!Array.isArray(value) || value.length < 4) throw new SkipError('invalid_geometry')
  const points = value.map(position)
  const first = points[0]!
  const last = points[points.length - 1]!
  if (first[0] !== last[0] || first[1] !== last[1]) throw new SkipError('invalid_geometry')
  if (new Set(points.slice(1).map((p) => `${p[0]},${p[1]}`)).size < 3) throw new SkipError('invalid_geometry')
  return points
}

function polygon(value: unknown): Position[][] {
  if (!Array.isArray(value) || value.length === 0) throw new SkipError('invalid_geometry')
  return value.map(ring)
}

function geometry(value: unknown, osmType: OsmType): BuildingGeometry {
  if (!isObject(value)) throw new SkipError('invalid_geometry')
  switch (value.type) {
    case 'Polygon':
      if (osmType === 'node') throw new SkipError('invalid_geometry')
      return { type: 'Polygon', coordinates: polygon(value.coordinates) }
    case 'MultiPolygon': {
      if (osmType === 'node' || !Array.isArray(value.coordinates) || value.coordinates.length === 0)
        throw new SkipError('invalid_geometry')
      return { type: 'MultiPolygon', coordinates: value.coordinates.map(polygon) }
    }
    case 'Point':
      if (osmType !== 'node') throw new SkipError('invalid_geometry')
      return { type: 'Point', coordinates: position(value.coordinates) }
    default:
      throw new SkipError('invalid_geometry')
  }
}

/** Order-independent key of the outer shells, so a way and a relation with the same footprint collapse. */
function geometryKey(g: BuildingGeometry): string {
  const round = (p: Position) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
  const ringKey = (r: Position[]) => r.slice(0, -1).map(round).sort().join(';')
  if (g.type === 'Point') return `pt:${round(g.coordinates)}`
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys
    .map((p) => p.map(ringKey).join('|'))
    .sort()
    .join('#')
}

export function formatAddress(tags: Record<string, string>): string | null {
  if (tags['addr:full']) return tags['addr:full']
  const street = tags['addr:street'] ?? tags['addr:place']
  const house = tags['addr:housenumber']
  if (street && house) return `${street}, ${house}`
  return street ?? null
}

function category(tags: Record<string, string>): string | null {
  const building = tags.building
  const value = tags.amenity ?? tags.shop ?? tags.tourism ?? (building && building !== 'yes' ? building : null)
  return value ? value.slice(0, 64) : null
}

export function parseOsmGeoJson(input: unknown): ParseResult {
  if (!isObject(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features))
    throw new GeoJsonFormatError('expected a GeoJSON FeatureCollection')

  const byRef = new Map<string, { index: number; feature: OsmBuildingInput }>()
  const skipped: SkippedFeature[] = []

  input.features.forEach((raw: unknown, index) => {
    let ref: string | null = null
    try {
      if (!isObject(raw) || raw.type !== 'Feature') throw new SkipError('invalid_geometry')
      const props = isObject(raw.properties) ? raw.properties : {}
      const id = featureRef(raw, props)
      if (!id) throw new SkipError('invalid_id')
      ref = `${id.osmType}/${id.osmId}`
      const tags = featureTags(props)
      if (!tags.building || tags.building === 'no') throw new SkipError('not_building')
      const feature: OsmBuildingInput = {
        ...id,
        geometry: geometry(raw.geometry, id.osmType),
        name: tags['name:ru'] ?? tags.name ?? null,
        address: formatAddress(tags),
        category: category(tags),
        tags,
      }
      const previous = byRef.get(ref)
      if (previous) skipped.push({ index: previous.index, ref, reason: 'duplicate_id' }) // last one wins
      byRef.set(ref, { index, feature })
    } catch (e) {
      if (!(e instanceof SkipError)) throw e
      skipped.push({ index, ref, reason: e.reason })
    }
  })

  const features: OsmBuildingInput[] = []
  const seenGeometry = new Set<string>()
  for (const { index, feature } of byRef.values()) {
    const key = geometryKey(feature.geometry)
    if (seenGeometry.has(key)) {
      skipped.push({ index, ref: `${feature.osmType}/${feature.osmId}`, reason: 'duplicate_geometry' })
      continue
    }
    seenGeometry.add(key)
    features.push(feature)
  }
  skipped.sort((a, b) => a.index - b.index)
  return { features, skipped }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
