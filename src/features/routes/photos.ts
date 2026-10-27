/**
 * Photos of Zavidovo (src/assets/zavidovo, from the owner on 2026-10-27), named by the key they
 * illustrate: a place id (`zav-bay`), a route slug (`zav-catch-wave`) or a step slug (`wave-4`).
 * Bundled with the app: the URLs are resolved at build time, the files load only when shown.
 */
import type { AreaPlace, QuestRoute, RouteStep } from '@/types/game'

const files = import.meta.glob<string>('@/assets/zavidovo/*.webp', { eager: true, import: 'default' })
const BY_KEY = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]))

export const placePhoto = (p: AreaPlace | null): string | null => (p ? (BY_KEY.get(p.id) ?? null) : null)

/** the step's own photo, else its place's */
export const stepPhoto = (s: RouteStep): string | null => BY_KEY.get(s.slug) ?? placePhoto(s.place)

/** the route's cover, else the photo of its first step that has one */
export function routePhoto(r: QuestRoute): string | null {
  return BY_KEY.get(r.slug) ?? r.steps.map(stepPhoto).find((url) => url !== null) ?? null
}
