import type { BuildingOutline } from '@/types/game'

/**
 * Which building is the camera pointing at, from GPS + compass + OSM footprints only.
 *
 * This is an approximation, not recognition: GPS is off by 5–30 m in the city and a phone compass
 * by 10–30°, which at 50 m is a whole facade. So the result always carries a status, and only a
 * clear winner is reported as `likely`; everything else asks the player to choose.
 *
 * Method: rays are cast across a cone around the heading; each ray stops at the first footprint
 * edge it meets (nearer buildings hide farther ones). A building's score is the weighted share of
 * rays that hit it first; the cone widens with compass and GPS uncertainty.
 */

export interface ScanPosition {
  lat: number
  lng: number
  accuracyM: number
}

export interface ScanHeading {
  /** degrees clockwise from true/magnetic north, 0..360 */
  deg: number
  /** ± degrees; null when the platform does not report it */
  accuracyDeg: number | null
}

export interface RankedCandidate {
  outline: BuildingOutline
  /** share of the (weighted) view cone this building occupies first, 0..1 */
  score: number
  /** distance to the nearest visible facade point along the rays, metres */
  distanceM: number
}

export interface NearbyBuilding {
  outline: BuildingOutline
  /** distance to the footprint (0 when the position is inside it), metres */
  distanceM: number
}

export type MatchStatus =
  /** one building clearly dominates the view (still approximate) */
  | 'likely'
  /** several buildings share the view or the compass is too rough: the player chooses */
  | 'ambiguous'
  /** the view cone hits no known building within range */
  | 'none'
  /** no compass: the player chooses from nearby buildings */
  | 'no_heading'
  /** GPS too rough to say anything about the view */
  | 'inaccurate'

export interface MatchResult {
  status: MatchStatus
  candidates: RankedCandidate[]
  best: RankedCandidate | null
  /** best.score − second.score (best.score when alone) */
  margin: number
  /** half-width of the view cone used, degrees; 0 without heading */
  coneDeg: number
  nearby: NearbyBuilding[]
  /** footprint the GPS position falls into (usually GPS error, or the player is indoors) */
  insideId: number | null
}

export const MATCH = {
  maxRangeM: 150,
  maxAccuracyM: 35,
  /** compass accuracy assumed when the platform reports none */
  defaultHeadingAccDeg: 25,
  maxHeadingAccDeg: 30,
  minConeDeg: 6,
  maxConeDeg: 40,
  rayStepDeg: 1,
  minScore: 0.55,
  minMargin: 0.25,
  nearbyRadiusM: 80,
  nearbyLimit: 6,
} as const

type Pt = [number, number] // metres east, north of the player

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LNG_EQ = 111_320
const RAD = Math.PI / 180

interface Shape {
  outline: BuildingOutline
  rings: Pt[][]
  /** outer rings only (for the inside test) */
  outers: Pt[][]
}

function project(origin: ScanPosition): (p: GeoJSON.Position) => Pt {
  const kx = Math.cos(origin.lat * RAD) * M_PER_DEG_LNG_EQ
  return (p) => [((p[0] ?? 0) - origin.lng) * kx, ((p[1] ?? 0) - origin.lat) * M_PER_DEG_LAT]
}

/** buildings mapped as one OSM node become a small octagon so rays can still hit them */
const NODE_RADIUS_M = 5

function shapeOf(outline: BuildingOutline, toPt: (p: GeoJSON.Position) => Pt): Shape {
  const g = outline.geometry
  if (g.type === 'Point') {
    const [cx, cy] = toPt(g.coordinates)
    const ring: Pt[] = Array.from({ length: 9 }, (_, i) => {
      const a = (i % 8) * (Math.PI / 4)
      return [cx + NODE_RADIUS_M * Math.cos(a), cy + NODE_RADIUS_M * Math.sin(a)]
    })
    return { outline, rings: [ring], outers: [ring] }
  }
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  const rings = polygons.flatMap((poly) => poly.map((ring) => ring.map(toPt)))
  const outers = polygons.flatMap((poly) => (poly[0] ? [poly[0].map(toPt)] : []))
  return { outline, rings, outers }
}

/** ray from the origin along unit (dx, dy) against segment a→b; distance or null */
function raySegment(dx: number, dy: number, a: Pt, b: Pt): number | null {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const denom = dx * ey - dy * ex
  if (Math.abs(denom) < 1e-12) return null // parallel
  const t = (a[0] * ey - a[1] * ex) / denom
  const u = (a[0] * dy - a[1] * dx) / denom
  return t >= 0 && u >= 0 && u <= 1 ? t : null
}

function contains(ring: Pt[], x = 0, y = 0): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segmentDistance(a: Pt, b: Pt): number {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const len2 = ex * ex + ey * ey
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * ex + a[1] * ey) / len2))
  return Math.hypot(a[0] + t * ex, a[1] + t * ey)
}

function distanceTo(shape: Shape): number {
  if (shape.outers.some((r) => contains(r))) return 0
  let best = Infinity
  for (const ring of shape.rings) for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentDistance(ring[i - 1]!, ring[i]!))
  return best
}

/** first footprint hit along a ray: [shape index, distance] */
function castRay(shapes: Shape[], skip: number, deg: number): [number, number] | null {
  const dx = Math.sin(deg * RAD)
  const dy = Math.cos(deg * RAD)
  let hit: [number, number] | null = null
  shapes.forEach((shape, idx) => {
    if (idx === skip) return
    for (const ring of shape.rings) {
      for (let i = 1; i < ring.length; i++) {
        const t = raySegment(dx, dy, ring[i - 1]!, ring[i]!)
        if (t !== null && t <= MATCH.maxRangeM && (hit === null || t < hit[1])) hit = [idx, t]
      }
    }
  })
  return hit
}

export function rankCandidates(position: ScanPosition, heading: ScanHeading | null, outlines: BuildingOutline[]): MatchResult {
  const toPt = project(position)
  const shapes = outlines.map((o) => shapeOf(o, toPt))
  const distances = shapes.map(distanceTo)
  const insideIdx = distances.findIndex((d) => d === 0)
  const nearby = shapes
    .map((s, i) => ({ outline: s.outline, distanceM: distances[i]! }))
    .filter((n) => n.distanceM <= MATCH.nearbyRadiusM + position.accuracyM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MATCH.nearbyLimit)
  const base = { nearby, insideId: insideIdx >= 0 ? shapes[insideIdx]!.outline.id : null }

  if (!heading) return { status: 'no_heading', candidates: [], best: null, margin: 0, coneDeg: 0, ...base }

  const headingAcc = heading.accuracyDeg ?? MATCH.defaultHeadingAccDeg
  // the player is never "looking at" the footprint the GPS puts them in
  const centre = castRay(shapes, insideIdx, heading.deg)
  const refDistance = Math.max(centre?.[1] ?? 50, 5)
  const gpsDeg = Math.atan(position.accuracyM / refDistance) / RAD
  const coneDeg = Math.min(MATCH.maxConeDeg, Math.max(MATCH.minConeDeg, Math.hypot(headingAcc, gpsDeg)))
  const sigma = coneDeg / 2

  const weight = new Map<number, number>()
  const nearest = new Map<number, number>()
  let total = 0
  for (let a = -coneDeg; a <= coneDeg + 1e-9; a += MATCH.rayStepDeg) {
    const w = Math.exp(-0.5 * (a / sigma) ** 2)
    total += w
    const hit = castRay(shapes, insideIdx, heading.deg + a)
    if (!hit) continue
    weight.set(hit[0], (weight.get(hit[0]) ?? 0) + w)
    nearest.set(hit[0], Math.min(nearest.get(hit[0]) ?? Infinity, hit[1]))
  }
  const candidates = [...weight.entries()]
    .map(([idx, w]) => ({ outline: shapes[idx]!.outline, score: w / total, distanceM: nearest.get(idx)! }))
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM)
  const best = candidates[0] ?? null
  const margin = best ? best.score - (candidates[1]?.score ?? 0) : 0

  let status: MatchStatus
  if (position.accuracyM > MATCH.maxAccuracyM) status = 'inaccurate'
  else if (!best) status = 'none'
  else if (headingAcc <= MATCH.maxHeadingAccDeg && best.score >= MATCH.minScore && margin >= MATCH.minMargin) status = 'likely'
  else status = 'ambiguous'

  return { status, candidates, best, margin, coneDeg, ...base }
}
