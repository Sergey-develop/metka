/** Engine-independent geometry helpers for map overlays. */

export type LngLatTuple = [number, number]

export function toLngLat(p: GeoJSON.Position): LngLatTuple {
  return [p[0] ?? 0, p[1] ?? 0]
}

/** Approximate visual centre of a multipolygon: area-weighted centroid of its largest part. */
export function labelPoint(geometry: GeoJSON.MultiPolygon): [number, number] | null {
  let best: { area: number; point: [number, number] } | null = null
  for (const polygon of geometry.coordinates) {
    const ring = polygon[0]
    if (!ring || ring.length < 4) continue
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0 = 0, y0 = 0] = ring[i] ?? []
      const [x1 = 0, y1 = 0] = ring[i + 1] ?? []
      const cross = x0 * y1 - x1 * y0
      a += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    if (a === 0) continue
    const area = Math.abs(a / 2)
    if (!best || area > best.area) best = { area, point: [cx / (3 * a), cy / (3 * a)] }
  }
  return best?.point ?? null
}

export function bounds(geometry: GeoJSON.MultiPolygon): [[number, number], [number, number]] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of geometry.coordinates)
    for (const ring of polygon)
      for (const [x = 0, y = 0] of ring) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/** "Old" Moscow plus the nearest part of New Moscow, as framed in the mockup. */
export const MOSCOW_BOUNDS: [[number, number], [number, number]] = [
  [37.33, 55.56],
  [37.9, 55.92],
]

function inRing(p: LngLatTuple, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? []
    const [xj = 0, yj = 0] = ring[j] ?? []
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point-in-multipolygon (ray casting; holes respected). */
export function containsPoint(geometry: GeoJSON.MultiPolygon, p: LngLatTuple): boolean {
  return geometry.coordinates.some(
    ([outer, ...holes]) => outer !== undefined && inRing(p, outer) && !holes.some((h) => inRing(p, h)),
  )
}
