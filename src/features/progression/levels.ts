/**
 * Display-side mirror of public.level_for_xp (supabase/migrations/..._game_functions.sql).
 * The server is authoritative; tests/db/progression.test.ts verifies both agree.
 * Total XP required to reach level L = 50 * L * (L - 1).
 */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level))
  return 50 * l * (l - 1)
}

export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1
  let level = Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2)
  while (xpForLevel(level + 1) <= xp) level++
  while (level > 1 && xpForLevel(level) > xp) level--
  return level
}

export interface LevelProgress {
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  /** 0..1 */
  ratio: number
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp)
  const start = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const xpIntoLevel = Math.max(0, xp - start)
  const span = next - start
  return { level, xpIntoLevel, xpForNextLevel: span, ratio: span > 0 ? Math.min(1, xpIntoLevel / span) : 0 }
}
