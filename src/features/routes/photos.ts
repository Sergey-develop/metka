/**
 * Photos of Zavidovo (src/assets/zavidovo, from the owner on 2026-10-27), named by the key they
 * illustrate: a place id (`zav-bay`), a route slug (`zav-catch-wave`) or a step slug (`wave-4`).
 * Bundled with the app: the URLs are resolved at build time, the files load only when shown.
 */
import type { AreaPlace, QuestRoute, RouteStep } from '@/types/game'

const files = import.meta.glob<string>('@/assets/zavidovo/*.webp', { eager: true, import: 'default' })
const BY_KEY = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]))

export const placePhoto = (p: AreaPlace | null): string | null => (p ? (BY_KEY.get(p.id) ?? null) : null)

/**
 * Photos from Wikimedia Commons: the licence asks for the author and the licence next to the photo.
 * `example`: a typical photo of such a place, not of this very one (no free photo of it exists).
 */
const CREDITS: Record<string, { author: string; license: string; url: string; example?: true }> = {
  'zav-memorial': {
    author: 'Kohomologie',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Братская_могила_Вараксино_общий_вид_01.jpg',
  },
  'zav-minigolf': {
    author: 'Wolf1949H',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Horner_Rennbahn_Minigolfanlage_2026.JPG',
    example: true,
  },
  'zav-alpaca': {
    author: 'AnRo0002',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:20170619Vicugna_pacos1.jpg',
    example: true,
  },
}
export const photoCredit = (p: AreaPlace | null) => (p ? (CREDITS[p.id] ?? null) : null)

/** the step's own photo, else its place's */
export const stepPhoto = (s: RouteStep): string | null => BY_KEY.get(s.slug) ?? placePhoto(s.place)

/** the route's cover, else the photo of its first step that has one */
export function routePhoto(r: QuestRoute): string | null {
  return BY_KEY.get(r.slug) ?? r.steps.map(stepPhoto).find((url) => url !== null) ?? null
}
