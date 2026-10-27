/** the tasks page's header (PageHero): height and the row of the back button and title, px below the safe area */
export const TASKS_HERO = { height: 150, rowY: 55 } as const

/** «3д 12ч 25мин» / «12ч 5мин» / «4мин» until the moment `ms` from now; «0мин» once it has passed */
export function timeLeft(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}д ${h}ч ${m}мин`
  if (h > 0) return `${h}ч ${m}мин`
  return `${m}мин`
}
