import cleanupArt from '@/assets/events/kind-cleanup.webp'
import readingArt from '@/assets/events/kind-reading.webp'
import runArt from '@/assets/events/kind-run.webp'
import walkArt from '@/assets/events/kind-walk.webp'
import type { ChipItem } from '@/components/ui/CategoryChips.vue'
import type { EventKind, GameEvent } from '@/types/game'

/** Event types of the wizard's first step (mockup Страница локации-6); art is cut from the mockup. */
export const KIND_INFO: Record<EventKind, { label: string; art: string; tone: 'sport' | 'culture' | 'free' }> = {
  run: { label: 'Пробежка', art: runArt, tone: 'sport' },
  walk: { label: 'Прогулка', art: walkArt, tone: 'sport' },
  reading: { label: 'Чтение', art: readingArt, tone: 'culture' },
  cleanup: { label: 'Субботник', art: cleanupArt, tone: 'free' },
}

const TZ = 'Europe/Moscow'
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

/** «16.02.26» in Moscow time */
export const shortDate = (d: Date) => d.toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' })
/** «16:00» in Moscow time */
export const clock = (d: Date) => d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
/** «Пн, 10:00» */
export function weekdayClock(d: Date): string {
  const wd = d.toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'short' })
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${clock(d)}`
}
/** «26 фев 10:00» for the feed list */
export function feedWhen(d: Date): string {
  const day = d.toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short' }).replace('.', '')
  return `${day} ${clock(d)}`
}
export const isSameMoscowDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)

/** the feed's type chips (CategoryChips colours) */
export const KIND_CHIPS: ChipItem[] = [
  { id: 'run', label: KIND_INFO.run.label, tone: 'sport' },
  { id: 'walk', label: KIND_INFO.walk.label, tone: 'kids' },
  { id: 'reading', label: KIND_INFO.reading.label, tone: 'culture' },
  { id: 'cleanup', label: KIND_INFO.cleanup.label, tone: 'free' },
]

export type WhenFilter = 'any' | 'today' | 'tomorrow' | 'weekend' | 'week'
export const WHEN_OPTIONS: { id: WhenFilter; label: string }[] = [
  { id: 'any', label: 'Любая дата' },
  { id: 'today', label: 'Сегодня' },
  { id: 'tomorrow', label: 'Завтра' },
  { id: 'weekend', label: 'На выходных' },
  { id: 'week', label: '7 дней' },
]

/** the feed's filter sheet */
export interface EventFilters {
  when: WhenFilter
  /** only events with free places (or the ones I'm already in) */
  freeSeats: boolean
  /** only events I organise or joined */
  mine: boolean
}
export const NO_FILTERS: EventFilters = { when: 'any', freeSeats: false, mine: false }
export const filtersActive = (f: EventFilters) => f.when !== 'any' || f.freeSeats || f.mine

const WEEK_MS = 7 * 86_400_000
const isMoscowWeekend = (d: Date) => ['Sat', 'Sun'].includes(d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }))

export function matchesFilters(e: GameEvent, f: EventFilters, now: Date): boolean {
  const start = new Date(e.startsAt)
  if (f.mine && !e.joined) return false
  if (f.freeSeats && !e.joined && e.participants >= e.maxParticipants) return false
  switch (f.when) {
    case 'today':
      return isSameMoscowDay(start, now)
    case 'tomorrow':
      return isSameMoscowDay(start, new Date(now.getTime() + 86_400_000))
    case 'weekend':
      return isMoscowWeekend(start) && start.getTime() - now.getTime() < WEEK_MS
    case 'week':
      return start.getTime() - now.getTime() < WEEK_MS
    default:
      return true
  }
}

/** Calendar date the player picks (the wizard works in Moscow time, like the whole game). */
export interface DayValue {
  year: number
  /** 1–12 */
  month: number
  day: number
}

export function moscowDay(d: Date): DayValue {
  const [year, month, day] = dayKey(d).split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

/** Moscow has no DST since 2014: UTC+3 all year */
const MOSCOW_OFFSET_H = 3
export function moscowInstant(day: DayValue, hour: number, minute: number): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, hour - MOSCOW_OFFSET_H, minute))
}

/** whole weeks from Monday covering the month (as in the mockup); `inMonth` false for the neighbours' days */
export function monthGrid(year: number, month: number): { day: DayValue; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, 1 + i - lead))
    return { day: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, inMonth: d.getUTCMonth() === month - 1 }
  })
}

export const sameDay = (a: DayValue, b: DayValue) => a.year === b.year && a.month === b.month && a.day === b.day
export const dayOrder = (d: DayValue) => d.year * 10_000 + d.month * 100 + d.day
