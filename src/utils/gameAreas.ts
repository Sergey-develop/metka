/**
 * Moscow is in the game only with VITE_MOSCOW=true (owner's decision, 2026-10-28: only Zavidovo for now).
 * Off, the app shows nothing of Moscow — no okrugs, buildings, «Москва ›» chip, share of Moscow — and the
 * map stays in Zavidovo. To bring it back set the variable (GitHub → Settings → Variables, then redeploy):
 * no code change, the server and its data are untouched.
 */
export const MOSCOW_ENABLED = import.meta.env.VITE_MOSCOW === 'true'

const ALL_AREAS = [
  { id: 'moscow', of: 'Москвы', bbox: [36.8, 55.1, 38.4, 56.2] },
  { id: 'zavidovo', of: 'Завидово', bbox: [36.48, 56.52, 36.58, 56.62] },
] as const

export type GameAreaId = (typeof ALL_AREAS)[number]['id']

/**
 * The game areas in play — mirror of in_game_area() on the server (migrations 022, 026):
 * [minLng, minLat, maxLng, maxLat]. `of` is the name after «Ты открыл X% …».
 */
export const GAME_AREAS = ALL_AREAS.filter((a) => MOSCOW_ENABLED || a.id !== 'moscow')

/** where the app starts and what the texts name when the player is in no game area */
export const HOME_AREA: GameAreaId = MOSCOW_ENABLED ? 'moscow' : 'zavidovo'

/**
 * Where the map chip takes the player in Zavidovo: the main bay at street level. Fitting the whole
 * area (≈6 × 11 km since the old village joined it) zooms out to an empty fog rectangle.
 */
export const ZAVIDOVO_HOME = { lng: 36.5187, lat: 56.5937, zoom: 15 } as const

/** the game area the point is in, or null outside all of them */
export function gameAreaAt(p: { lat: number; lng: number }): GameAreaId | null {
  const area = GAME_AREAS.find(({ bbox: [minLng, minLat, maxLng, maxLat] }) => p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat)
  return area?.id ?? null
}
