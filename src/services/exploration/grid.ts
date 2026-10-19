/**
 * Exploration grid — must match supabase/migrations/20261018000008_exploration.sql:
 *   y = floor((lat + 90) / 0.0002), x = floor((lng + 180) / 0.00036)
 * ≈ 22 × 22 m in Moscow. The server derives cells itself; the client uses this only to draw.
 */
export const CELL_LAT_DEG = 0.0002
export const CELL_LNG_DEG = 0.00036

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
