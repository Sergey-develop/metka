import { Preferences } from '@capacitor/preferences'
import type { PendingPointStore } from './explorationTracker'
import type { TrackPoint } from './trackFilter'

const isPoint = (v: unknown): v is TrackPoint =>
  typeof v === 'object' &&
  v !== null &&
  ['lat', 'lng', 'accuracy', 't'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number')

/**
 * Not-yet-uploaded exploration points in Capacitor Preferences (native key-value storage on
 * iOS/Android, localStorage on the web). Keyed by user id, so one account's points are never sent
 * on behalf of another. Only these few points are kept — never a full route history.
 */
export class PreferencesPendingPointStore implements PendingPointStore {
  private readonly key: string

  constructor(userId: string) {
    this.key = `metka.exploration.pending.${userId}`
  }

  async load(): Promise<TrackPoint[]> {
    const raw = (await Preferences.get({ key: this.key })).value
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isPoint) : []
    } catch {
      return []
    }
  }

  async save(points: TrackPoint[]): Promise<void> {
    if (points.length === 0) await Preferences.remove({ key: this.key })
    else await Preferences.set({ key: this.key, value: JSON.stringify(points) })
  }
}
