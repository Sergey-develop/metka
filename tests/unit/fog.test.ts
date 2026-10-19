import { describe, expect, it } from 'vitest'
import { fogGeometry, type FogArea } from '@/services/exploration/fog'
import { CELL_LAT_DEG, CELL_LNG_DEG, cellBounds, cellOf, corridorCells, type Cell } from '@/services/exploration/grid'

const [Y0, X0] = cellOf(55.6534, 37.6196)
const AREA: FogArea = [36.8, 55.1, 38.4, 56.2]
const c = (dy: number, dx: number): Cell => [Y0 + dy, X0 + dx]

/** signed area of a ring in cell units (lng/lat → grid) */
function ringArea(ring: number[][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = [ring[i]![0]! / CELL_LNG_DEG, ring[i]![1]! / CELL_LAT_DEG]
    const [x2, y2] = [ring[i + 1]![0]! / CELL_LNG_DEG, ring[i + 1]![1]! / CELL_LAT_DEG]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** even-odd point test against a whole MultiPolygon: is (lng, lat) fogged? */
function fogged(mp: { coordinates: number[][][][] }, lng: number, lat: number): boolean {
  let n = 0
  for (const poly of mp.coordinates) {
    let inPoly = false
    for (const ring of poly) {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i] as [number, number]
        const [xj, yj] = ring[j] as [number, number]
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
      }
      if (hit) inPoly = !inPoly
    }
    if (inPoly) n++
  }
  return n % 2 === 1
}
const centre = (cell: Cell): [number, number] => {
  const [a, b, cc, d] = cellBounds(cell)
  return [(a + cc) / 2, (b + d) / 2]
}

describe('fogGeometry', () => {
  it('no explored cells: the whole area is fog', () => {
    const g = fogGeometry([], AREA)
    expect(g.coordinates).toHaveLength(1)
    expect(g.coordinates[0]).toHaveLength(1)
  })

  it('a straight walk becomes one rectangular hole: cells merged, no gaps, exact edges', () => {
    const cells = Array.from({ length: 12 }, (_, i) => c(0, i))
    const g = fogGeometry(cells, AREA)
    expect(g.coordinates).toHaveLength(1)
    const hole = g.coordinates[0]![1]!
    expect(hole).toHaveLength(5) // 4 corners + closing point: merged, not 12 squares
    expect(ringArea(hole)).toBeCloseTo(-12, 6) // clockwise hole, exactly 12 cells
    expect(ringArea(g.coordinates[0]![0]!)).toBeGreaterThan(0) // outer counter-clockwise
    for (const cell of cells) expect(fogged(g, ...centre(cell))).toBe(false)
    expect(fogged(g, ...centre(c(1, 0)))).toBe(true)
    expect(fogged(g, ...centre(c(0, 12)))).toBe(true)
  })

  it('a walked-around block keeps its unexplored yard fogged; an explored spot in the yard is open again', () => {
    const cells: Cell[] = []
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (y === 0 || y === 6 || x === 0 || x === 6) cells.push(c(y, x))
    cells.push(c(3, 3)) // a single explored cell in the middle of the yard
    const g = fogGeometry(cells, AREA)
    expect(g.coordinates).toHaveLength(2) // main fog + the yard island
    for (const cell of cells) expect(fogged(g, ...centre(cell))).toBe(false)
    expect(fogged(g, ...centre(c(2, 2)))).toBe(true) // yard
    expect(fogged(g, ...centre(c(4, 5)))).toBe(true)
    expect(fogged(g, ...centre(c(3, 3)))).toBe(false) // explored spot inside the yard
    expect(fogged(g, ...centre(c(-1, 3)))).toBe(true) // outside the block
    const island = g.coordinates[1]!
    expect(ringArea(island[0]!)).toBeCloseTo(25 - 0, 6) // yard 5×5, outer CCW
    expect(ringArea(island[1]!)).toBeCloseTo(-1, 6) // explored cell as a CW hole
  })

  it('cells touching only at a corner stay separate rings and both stay open', () => {
    const g = fogGeometry([c(0, 0), c(1, 1)], AREA)
    expect(g.coordinates).toHaveLength(1)
    expect(g.coordinates[0]!.slice(1).map((r) => ringArea(r))).toEqual([-1, -1])
    expect(fogged(g, ...centre(c(0, 0)))).toBe(false)
    expect(fogged(g, ...centre(c(1, 1)))).toBe(false)
    expect(fogged(g, ...centre(c(0, 1)))).toBe(true)
    expect(fogged(g, ...centre(c(1, 0)))).toBe(true)
  })

  it('a real corridor walk: every explored cell open, every other nearby cell fogged, total area exact', () => {
    const kx = 111_320 * Math.cos((55.6534 * Math.PI) / 180)
    const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 55.6534 + (Math.sin(i / 4) * 40) / 111_320, lng: 37.6196 + (i * 9) / kx }))
    const cells = new Map<string, Cell>()
    for (let i = 1; i < pts.length; i++) for (const cell of corridorCells(pts[i - 1]!, pts[i]!)) cells.set(`${cell[0]}:${cell[1]}`, cell)
    const g = fogGeometry(cells.values(), AREA)
    let holes = 0
    for (const poly of g.coordinates) for (const ring of poly.slice(1)) holes += -ringArea(ring)
    for (const poly of g.coordinates.slice(1)) holes -= ringArea(poly[0]!) // fog islands give area back
    expect(holes).toBeCloseTo(cells.size, 6)
    const [ys, xs] = [[...cells.values()].map((v) => v[0]), [...cells.values()].map((v) => v[1])]
    for (let y = Math.min(...ys) - 2; y <= Math.max(...ys) + 2; y++) {
      for (let x = Math.min(...xs) - 2; x <= Math.max(...xs) + 2; x++) {
        expect(fogged(g, ...centre([y, x]))).toBe(!cells.has(`${y}:${x}`))
      }
    }
  })

  it('ignores cells outside the fogged area', () => {
    const g = fogGeometry([[cellOf(59.93, 30.31)[0], cellOf(59.93, 30.31)[1]]], AREA)
    expect(g.coordinates).toEqual([[[[36.8, 55.1], [38.4, 55.1], [38.4, 56.2], [36.8, 56.2], [36.8, 55.1]]]])
  })

  it('stays fast for a heavy explorer (~20k cells)', () => {
    const kx = 111_320 * Math.cos((55.7 * Math.PI) / 180)
    const cells = new Map<string, Cell>()
    let p = { lat: 55.7, lng: 37.6 }
    let a = 0
    for (let i = 0; i < 1500; i++) {
      a += Math.sin(i / 7) * 0.6
      const q = { lat: p.lat + (Math.cos(a) * 12) / 111_320, lng: p.lng + (Math.sin(a) * 12) / kx }
      for (const cell of corridorCells(p, q)) cells.set(`${cell[0]}:${cell[1]}`, cell)
      p = q
    }
    const t0 = performance.now()
    const g = fogGeometry(cells.values(), AREA)
    const ms = performance.now() - t0
    expect(g.coordinates.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(1500)
  })
})
