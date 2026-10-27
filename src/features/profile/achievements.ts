import type { QuestKind, QuestView } from '@/types/game'

/** Achievements are the server quests; the badge art only depends on the quest kind. */
const KIND_BADGE: Record<QuestKind, 'pin' | 'map' | 'compass'> = {
  discover_count: 'pin',
  discover_in_district: 'map',
  discover_rarity: 'compass',
  route_count: 'map',
  artifact_count: 'compass',
}

export const badgeKind = (q: QuestView) => KIND_BADGE[q.kind]

/** a reward waiting to be claimed first, then received, then the rest by progress */
export function sortAchievements(list: readonly QuestView[]): QuestView[] {
  const rank = (q: QuestView) => (q.completedAt && !q.claimedAt ? 0 : q.completedAt ? 1 : 2)
  return [...list].sort((a, b) => rank(a) - rank(b) || b.progress / b.target - a.progress / a.target)
}
