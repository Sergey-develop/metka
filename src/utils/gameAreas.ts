/**
 * Game areas — mirror of in_game_area() on the server (migration 022): [minLng, minLat, maxLng, maxLat].
 * `of` is the name after «Ты открыл X% …».
 */
export const GAME_AREAS = [
  { id: 'moscow', of: 'Москвы', bbox: [36.8, 55.1, 38.4, 56.2] },
  { id: 'zavidovo', of: 'Завидово', bbox: [36.48, 56.57, 36.58, 56.62] },
] as const

export type GameAreaId = (typeof GAME_AREAS)[number]['id']

/** the game area the point is in, or null outside all of them */
export function gameAreaAt(p: { lat: number; lng: number }): GameAreaId | null {
  const area = GAME_AREAS.find(({ bbox: [minLng, minLat, maxLng, maxLat] }) => p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat)
  return area?.id ?? null
}
