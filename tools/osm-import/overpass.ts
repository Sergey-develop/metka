/**
 * Converts an Overpass API response (`out geom;`) with building ways and multipolygon
 * relations into GeoJSON that parseOsmGeoJson() accepts. Pure; I/O lives in fetch-overpass.ts.
 */
import type { Position } from './geojson.ts'

interface LatLon {
  lat: number
  lon: number
}
interface OverpassMember {
  type: string
  ref: number
  role: string
  geometry?: LatLon[]
}
interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: LatLon[]
  members?: OverpassMember[]
}

export interface OverpassFeature {
  type: 'Feature'
  id: string
  properties: Record<string, string>
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Position[][] | Position[][][] }
}

const toPositions = (g: LatLon[]): Position[] => g.map((p) => [p.lon, p.lat])
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]

/** Joins open way segments into closed rings by matching endpoints; drops what cannot close. */
export function assembleRings(segments: Position[][]): Position[][] {
  const open = segments.filter((s) => s.length >= 2).map((s) => [...s])
  const rings: Position[][] = []
  while (open.length > 0) {
    let current = open.shift()!
    let extended = true
    while (!same(current[0]!, current[current.length - 1]!) && extended) {
      extended = false
      const tail = current[current.length - 1]!
      for (let i = 0; i < open.length; i++) {
        const s = open[i]!
        if (same(s[0]!, tail)) current = current.concat(s.slice(1))
        else if (same(s[s.length - 1]!, tail)) current = current.concat([...s].reverse().slice(1))
        else continue
        open.splice(i, 1)
        extended = true
        break
      }
    }
    if (current.length >= 4 && same(current[0]!, current[current.length - 1]!)) rings.push(current)
  }
  return rings
}

function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function relationGeometry(members: OverpassMember[]): Position[][][] {
  const segs = (role: string) =>
    members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => toPositions(m.geometry!))
  const polygons: Position[][][] = assembleRings(segs('outer')).map((outer) => [outer])
  for (const inner of assembleRings(segs('inner'))) {
    const host = polygons.find((p) => pointInRing(inner[0]!, p[0]!))
    host?.push(inner)
  }
  return polygons
}

export function overpassToGeoJson(response: unknown): { type: 'FeatureCollection'; features: OverpassFeature[] } {
  const elements =
    typeof response === 'object' && response !== null && Array.isArray((response as { elements?: unknown }).elements)
      ? ((response as { elements: OverpassElement[] }).elements)
      : null
  if (!elements) throw new Error('expected an Overpass JSON response with "elements"')

  const features: OverpassFeature[] = []
  for (const el of elements) {
    if (!el.tags?.building) continue
    const id = `${el.type}/${el.id}`
    if (el.type === 'way' && el.geometry) {
      const ring = toPositions(el.geometry)
      features.push({ type: 'Feature', id, properties: { ...el.tags }, geometry: { type: 'Polygon', coordinates: [ring] } })
    } else if (el.type === 'relation' && el.members) {
      const polygons = relationGeometry(el.members)
      if (polygons.length === 0) continue
      features.push({
        type: 'Feature',
        id,
        properties: { ...el.tags },
        geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0]! } : { type: 'MultiPolygon', coordinates: polygons },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function buildingsQuery(bbox: { south: number; west: number; north: number; east: number }): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:120];(way["building"](${b});relation["building"]["type"="multipolygon"](${b}););out geom;`
}
