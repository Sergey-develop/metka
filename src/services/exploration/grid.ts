/**
 * Exploration grid — must match supabase/migrations/20261019000013_fine_exploration_grid.sql:
 *   y = floor((lat + 90) / 0.0001), x = floor((lng + 180) / 0.00018)
 * ≈ 11.1 × 11.3 m in central Moscow (11.1 × 11.1–11.5 m across the game area). Exactly half the
 * previous 0.0002 × 0.00036 grid, so an old cell (y, x) is the four cells (2y..2y+1, 2x..2x+1).
 * The server derives cells itself; the client uses this to draw and to preview.
 */
export const CELL_LAT_DEG = 0.0001
export const CELL_LNG_DEG = 0.00018

/**
 * A walked segment reveals every cell whose centre is within this distance of it: an ≈16 m wide
 * corridor on average (2 × 8 m). The actual width depends on the walking direction relative to the
 * grid, about 10–22 m (one row of cells when walking along cell centres, two along a row boundary).
 * 8 m is also above the cell's half-diagonal (7.88–7.99 m in the game area), so the cell under every
 * point of the path is always included and the corridor has no gaps.
 */
export const CORRIDOR_HALF_WIDTH_M = 8

/** metres per degree used by the corridor test (local equirectangular; same constants in SQL) */
export const CORRIDOR_M_PER_DEG = 111_320

/** [cell_y, cell_x] as returned by the server */
export type Cell = readonly [y: number, x: number]

export function cellOf(lat: number, lng: number): Cell {
  return [Math.floor((lat + 90) / CELL_LAT_DEG), Math.floor((lng + 180) / CELL_LNG_DEG)]
}

/** Structurally a GeoJSON MultiPolygon (kept local: this file is also used by the DB tests). */
export interface CellsMultiPolygon {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

export const cellKey = ([y, x]: Cell): string => `${y}:${x}`

/** [minLng, minLat, maxLng, maxLat] */
export function cellBounds([y, x]: Cell): [number, number, number, number] {
  return [x * CELL_LNG_DEG - 180, y * CELL_LAT_DEG - 90, (x + 1) * CELL_LNG_DEG - 180, (y + 1) * CELL_LAT_DEG - 90]
}

interface LatLng {
  lat: number
  lng: number
}

/**
 * Cells revealed by walking from a to b: centres within halfWidthM of the segment (a capsule).
 * Mirrors public._corridor_cells() in migration 013; the server result is authoritative.
 */
export function corridorCells(a: LatLng, b: LatLng, halfWidthM = CORRIDOR_HALF_WIDTH_M): Cell[] {
  const ky = CORRIDOR_M_PER_DEG
  const kx = CORRIDOR_M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const ex = (b.lng - a.lng) * kx
  const ey = (b.lat - a.lat) * ky
  const len2 = ex * ex + ey * ey
  const dLat = halfWidthM / ky
  const dLng = halfWidthM / kx
  const [y0, x0] = cellOf(Math.min(a.lat, b.lat) - dLat, Math.min(a.lng, b.lng) - dLng)
  const [y1, x1] = cellOf(Math.max(a.lat, b.lat) + dLat, Math.max(a.lng, b.lng) + dLng)
  const out: Cell[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = ((x + 0.5) * CELL_LNG_DEG - 180 - a.lng) * kx
      const py = ((y + 0.5) * CELL_LAT_DEG - 90 - a.lat) * ky
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ey) / len2))
      if (Math.hypot(px - t * ex, py - t * ey) <= halfWidthM) out.push([y, x])
    }
  }
  return out
}

/**
 * Cells → one MultiPolygon for a single map feature. Horizontal runs of adjacent cells in a row
 * become one rectangle, so a walked street is a handful of polygons, not hundreds of squares.
 */
export function cellsToMultiPolygon(cells: Iterable<Cell>): CellsMultiPolygon {
  const rows = new Map<number, number[]>()
  for (const [y, x] of cells) {
    const row = rows.get(y)
    if (row) row.push(x)
    else rows.set(y, [x])
  }
  const coordinates: number[][][][] = []
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b)
    let start = xs[0]!
    let prev = start
    const flush = () => {
      const [minLng, minLat] = cellBounds([y, start])
      const [, , maxLng, maxLat] = cellBounds([y, prev])
      coordinates.push([
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ],
      ])
    }
    for (const x of xs.slice(1)) {
      if (x === prev) continue
      if (x !== prev + 1) {
        flush()
        start = x
      }
      prev = x
    }
    flush()
  }
  return { type: 'MultiPolygon', coordinates }
}
