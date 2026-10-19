import { CELL_LAT_DEG, CELL_LNG_DEG, type Cell } from './grid'

/**
 * Fog of War geometry: the game area minus the explored cells, as one GeoJSON MultiPolygon.
 *
 * The explored cells are merged along shared edges into closed rings (no gaps or overlaps between
 * neighbouring cells), then nested correctly: explored regions are holes in the fog, an unexplored
 * yard inside a walked-around block is fog again (an island polygon), and so on. Cells that touch
 * only at a corner stay separate rings. Coordinates are exact cell corners of the shared grid.
 */

/** Structurally a GeoJSON MultiPolygon (kept local: no DOM/GeoJSON types needed in tests). */
export interface FogMultiPolygon {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

/** [minLng, minLat, maxLng, maxLat] of the fogged area */
export type FogArea = readonly [number, number, number, number]

type V = [x: number, y: number] // grid corner (cell x, cell y)
interface Ring {
  pts: V[]
  /** signed area in cell units: > 0 counter-clockwise (outer boundary of explored land) */
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const vkey = (x: number, y: number) => `${x},${y}`

/** Directed boundary edges with the explored cell on the left; each edge belongs to one ring. */
function boundaryEdges(cells: Iterable<Cell>): { set: Set<string>; out: Map<string, V[]> } {
  const set = new Set<string>()
  for (const [y, x] of cells) set.add(vkey(x, y))
  const out = new Map<string, V[]>()
  const add = (fx: number, fy: number, tx: number, ty: number) => {
    const k = vkey(fx, fy)
    const list = out.get(k)
    if (list) list.push([tx, ty])
    else out.set(k, [[tx, ty]])
  }
  for (const k of set) {
    const [x, y] = k.split(',').map(Number) as [number, number]
    if (!set.has(vkey(x, y - 1))) add(x, y, x + 1, y) // south side, going east
    if (!set.has(vkey(x + 1, y))) add(x + 1, y, x + 1, y + 1) // east side, going north
    if (!set.has(vkey(x, y + 1))) add(x + 1, y + 1, x, y + 1) // north side, going west
    if (!set.has(vkey(x - 1, y))) add(x, y + 1, x, y) // west side, going south
  }
  return { set, out }
}

/** cross product sign of turning from direction a to b: > 0 left, < 0 right */
const turn = (a: V, b: V) => a[0] * b[1] - a[1] * b[0]

function traceRings(out: Map<string, V[]>): Ring[] {
  const rings: Ring[] = []
  for (const [startKey, targets] of out) {
    while (targets.length > 0) {
      const [sx, sy] = startKey.split(',').map(Number) as [number, number]
      const pts: V[] = [[sx, sy]]
      let prev: V = [sx, sy]
      let cur = targets.pop()!
      let guard = 0
      while (!(cur[0] === sx && cur[1] === sy)) {
        const dir: V = [cur[0] - prev[0], cur[1] - prev[1]]
        const options = out.get(vkey(cur[0], cur[1]))
        if (!options || options.length === 0 || ++guard > 4_000_000) throw new Error('fog: open boundary')
        // two ways out only where cells touch diagonally: take the left turn so they stay separate
        let pick = 0
        if (options.length > 1) {
          let best = -Infinity
          options.forEach((o, i) => {
            const t = turn(dir, [o[0] - cur[0], o[1] - cur[1]])
            if (t > best) {
              best = t
              pick = i
            }
          })
        }
        const next = options.splice(pick, 1)[0]!
        pts.push(cur)
        prev = cur
        cur = next
      }
      rings.push(simplify(pts))
    }
  }
  return rings
}

/** drops vertices in the middle of straight runs; computes area and bounds */
function simplify(raw: V[]): Ring {
  const pts: V[] = []
  const n = raw.length
  for (let i = 0; i < n; i++) {
    const a = raw[(i - 1 + n) % n]!
    const b = raw[i]!
    const c = raw[(i + 1) % n]!
    if (turn([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]) !== 0) pts.push(b)
  }
  let area = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[(i + 1) % pts.length]!
    area += x1 * y2 - x2 * y1
    minX = Math.min(minX, x1)
    minY = Math.min(minY, y1)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  return { pts, area: area / 2, minX, minY, maxX, maxY }
}

/** even-odd test of a point against a ring (the point is never on a ring edge, see below) */
function inside(ring: Ring, px: number, py: number): boolean {
  if (px < ring.minX || px > ring.maxX || py < ring.minY || py > ring.maxY) return false
  let hit = false
  const p = ring.pts
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!
    const [xj, yj] = p[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/**
 * A point just inside the ring's own region: the middle of its first edge, nudged a quarter cell to
 * the left of the edge (rings run with their region on the left). It lies inside a cell, never on
 * any ring edge, so containment tests are exact.
 */
function probe(ring: Ring): [number, number] {
  const [ax, ay] = ring.pts[0]!
  const [bx, by] = ring.pts[1]!
  const len = Math.hypot(bx - ax, by - ay)
  const mx = ax + ((bx - ax) / len) * 0.5
  const my = ay + ((by - ay) / len) * 0.5
  return [mx - ((by - ay) / len) * 0.25, my + ((bx - ax) / len) * 0.25]
}

const toLngLat = ([x, y]: V): number[] => [x * CELL_LNG_DEG - 180, y * CELL_LAT_DEG - 90]

function closed(pts: V[], reverse: boolean): number[][] {
  const seq = reverse ? [...pts].reverse() : pts
  const coords = seq.map(toLngLat)
  coords.push(coords[0]!)
  return coords
}

/**
 * Fog over `area` with the explored cells cut out. GeoJSON winding: outer rings counter-clockwise,
 * holes clockwise. Cells outside the area are ignored.
 */
export function fogGeometry(cells: Iterable<Cell>, area: FogArea): FogMultiPolygon {
  const [minLng, minLat, maxLng, maxLat] = area
  const inArea: Cell[] = []
  for (const c of cells) {
    const lng = c[1] * CELL_LNG_DEG - 180
    const lat = c[0] * CELL_LAT_DEG - 90
    if (lng >= minLng && lng + CELL_LNG_DEG <= maxLng && lat >= minLat && lat + CELL_LAT_DEG <= maxLat) inArea.push(c)
  }
  const outerArea = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ]
  if (inArea.length === 0) return { type: 'MultiPolygon', coordinates: [[outerArea]] }

  const rings = traceRings(boundaryEdges(inArea).out)
  // parent = the smallest ring that contains this ring's probe point
  const order = rings.map((r, i) => i).sort((a, b) => Math.abs(rings[a]!.area) - Math.abs(rings[b]!.area))
  const parent = new Map<number, number | null>()
  for (const i of order) {
    const [px, py] = probe(rings[i]!)
    let found: number | null = null
    for (const j of order) {
      if (j === i || Math.abs(rings[j]!.area) <= Math.abs(rings[i]!.area)) continue
      if (inside(rings[j]!, px, py)) {
        found = j
        break // order is by area: the first container is the smallest
      }
    }
    parent.set(i, found)
  }

  // explored outlines (CCW) become holes of the fog polygon they sit in; unexplored islands (CW)
  // become fog polygons of their own
  const main: number[][][] = [outerArea]
  const islands = new Map<number, number[][][]>()
  rings.forEach((r, i) => {
    if (r.area < 0) islands.set(i, [closed(r.pts, true)]) // CW → CCW outer
  })
  rings.forEach((r, i) => {
    if (r.area <= 0) return
    // nearest enclosing island; explored land is never directly inside explored land (it would be
    // the same region), but climb defensively instead of dropping the hole
    let p = parent.get(i) ?? null
    while (p !== null && !islands.has(p)) p = parent.get(p) ?? null
    const hole = closed(r.pts, true) // CCW → CW hole
    if (p === null) main.push(hole)
    else islands.get(p)!.push(hole)
  })
  return { type: 'MultiPolygon', coordinates: [main, ...islands.values()] }
}
