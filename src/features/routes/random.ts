import type { AreaPlace, LngLat, PlaceTag } from '@/types/game'
import { distanceMeters } from '@/utils/geo'

/**
 * «Случайное Завидово» (content plan, route № 4): a short walk picked from the places by the player's
 * answers. Client-side: the stops are suggestions, each is still checked in on site.
 */
export type Mood = 'surprise' | 'relax' | 'move'
export type Company = 'alone' | 'pair' | 'kids' | 'friends'
export type Minutes = 20 | 30 | 45
export type Reach = 'near' | 'resort'

export interface RandomAnswers {
  mood: Mood
  minutes: Minutes
  company: Company
  reach: Reach
}

type Pointed = AreaPlace & { lat: number; lng: number }

const MOOD_TAGS: Record<Mood, PlaceTag[]> = {
  surprise: ['free', 'culture'],
  relax: ['rest', 'free'],
  move: ['sport', 'free'],
}
const STOPS: Record<Minutes, number> = { 20: 2, 30: 3, 45: 4 }
const NEAR_M = 800
/** walking ≈ 5 km/h */
export const M_PER_MIN = 83

export interface RandomWalk {
  stops: { place: Pointed; legM: number }[]
  totalM: number
  minutes: number
}

/**
 * Picks the stops: places that fit the mood (and the kids), visited ones last, ordered as a walk from
 * `start` by the nearest next stop; a pair or friends finish at a café or a place to rest.
 * `random` breaks ties, so «Другой вариант» gives another walk.
 */
export function pickWalk(
  places: AreaPlace[],
  answers: RandomAnswers,
  start: LngLat,
  visited: ReadonlySet<string>,
  random: () => number = Math.random,
): RandomWalk {
  const tags = MOOD_TAGS[answers.mood]
  const total = STOPS[answers.minutes]
  const finishAtTable = answers.company === 'pair' || answers.company === 'friends'
  const pool = places
    .filter((p): p is Pointed => p.lat !== null && p.lng !== null)
    .filter((p) => answers.reach === 'resort' || distanceMeters(start, p) <= NEAR_M)

  const score = (p: Pointed) =>
    p.tags.filter((t) => tags.includes(t)).length * 2 +
    (answers.company === 'kids' && p.tags.includes('kids') ? 2 : 0) -
    (visited.has(p.id) ? 3 : 0) +
    random()
  const scored = new Map(pool.map((p) => [p.id, score(p)]))
  const walkStops = pool.filter((p) => !p.tags.includes('food') && (scored.get(p.id) ?? 0) >= 1)

  const picked: Pointed[] = []
  let at: LngLat = start
  const want = finishAtTable ? total - 1 : total
  const candidates = [...walkStops].sort((a, b) => scored.get(b.id)! - scored.get(a.id)!).slice(0, Math.max(want * 2, want))
  while (picked.length < want && candidates.length) {
    // the nearest of the well-fitting places, so the walk does not zigzag across the resort
    candidates.sort((a, b) => distanceMeters(at, a) - distanceMeters(at, b))
    const next = candidates.shift()!
    picked.push(next)
    at = next
  }
  if (finishAtTable) {
    const table = pool
      .filter((p) => (p.tags.includes('food') || p.tags.includes('rest')) && !picked.includes(p))
      .sort((a, b) => distanceMeters(at, a) - distanceMeters(at, b))[0]
    if (table) picked.push(table)
  }

  let from: LngLat = start
  const stops = picked.map((place) => {
    const legM = distanceMeters(from, place)
    from = place
    return { place, legM }
  })
  const totalM = stops.reduce((sum, s) => sum + s.legM, 0)
  return { stops, totalM, minutes: Math.round(totalM / M_PER_MIN) }
}
