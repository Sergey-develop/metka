import type { FilledIconName } from '@/components/ui/icons'
import type { ClanPage } from '@/types/game'
import { plural } from '@/utils/plural'

type Member = ClanPage['members'][number]
type Entry = ClanPage['chronicle'][number]

/** Members by this week's cells (most first, joining order on ties) with their share of the clan's week, %. */
export function weeklyRanking(members: Member[]): (Member & { share: number })[] {
  const total = members.reduce((sum, m) => sum + m.weekCells, 0)
  return members
    .map((m, i) => ({ ...m, share: total > 0 ? Math.round((m.weekCells / total) * 100) : 0, i }))
    .sort((a, b) => b.weekCells - a.weekCells || a.i - b.i)
    .map(({ i: _i, ...m }) => m)
}

const fmt = (n: number) => n.toLocaleString('ru-RU')

/**
 * The clan page's header (PageHero), px below the safe area: `bodyTop` — where the white body starts;
 * `height` — the header goes 24px further, under the body's rounded corners (else the corners show
 * what is behind); `rowY` — the row of buttons.
 */
export const CLAN_HERO = { bodyTop: 170, height: 194, rowY: 66 } as const

/** «Открыть 800 клеток в ЦАО» / «… Москвы» when the leader has no home district */
export function goalTitle(page: ClanPage): string {
  const g = page.week.goal
  const cells = `${fmt(g.target)} ${plural(g.target, ['клетку', 'клетки', 'клеток'])}`
  return g.districtName ? `Открыть ${cells} в ${g.districtName}` : `Открыть ${cells} Москвы`
}

export const daysLeftText = (page: ClanPage) => `${page.week.daysLeft} ${plural(page.week.daysLeft, ['день', 'дня', 'дней'])} до конца`

/** one explored cell is 0.0001° × 0.00018° ≈ 11.1 m × 11.3 m in Moscow (same as the profile) */
const CELL_M2 = 125.6

export interface ClanMetric {
  icon: FilledIconName
  tone: 'blue' | 'yellow' | 'pink' | 'red'
  value: string
  unit?: string
  label: string
}

/** the four tiles of «Метрики клана» */
export function clanMetrics(page: ClanPage): ClanMetric[] {
  const owned = page.ownedDistrictIds.length
  const km2 = (page.metrics.exploredCells * CELL_M2) / 1e6
  return [
    { icon: 'map', tone: 'blue', value: fmt(owned), label: `${plural(owned, ['Округ', 'Округа', 'Округов'])} во владении` },
    { icon: 'runner', tone: 'yellow', value: km2.toLocaleString('ru-RU', { maximumFractionDigits: km2 < 10 ? 2 : 1 }), unit: 'км²', label: 'Исследовано вместе' },
    { icon: 'pin', tone: 'pink', value: fmt(page.metrics.discoveries), label: 'Открытых объектов' },
    { icon: 'questsDone', tone: 'red', value: fmt(page.metrics.level), label: 'Уровень клана' },
  ]
}

// past-tense verbs would need the player's gender, which the game does not know: the text names the event instead
export function chronicleText(e: Entry): string {
  if (e.kind === 'joined') return `${e.username} — новый участник клана`
  return e.rarity === 'legendary' ? `${e.username}: легендарная находка «${e.buildingName}»` : `${e.username}: открыт объект «${e.buildingName}»`
}

const TZ = 'Europe/Moscow'
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

/** «Сегодня, 18:37» / «Вчера, 21:24» / «12 октября, 09:05», Moscow time */
export function chronicleTime(at: string, now = new Date()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  if (dayKey(d) === dayKey(now)) return `Сегодня, ${time}`
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return `Вчера, ${time}`
  return `${d.toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' })}, ${time}`
}
