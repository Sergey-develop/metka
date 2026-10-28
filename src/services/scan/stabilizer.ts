import type { MatchResult } from './candidates'

export interface Selection {
  /** osm_buildings.id of the building the card shows, null — none */
  id: number | null
  /** chosen by the player (stays until released) or picked automatically */
  manual: boolean
}

export interface StabilizerOptions {
  /** a new building must stay the clear winner this long before the card switches to it */
  holdMs: number
  /** without a clear winner the current selection survives this long (compass/GPS jitter) */
  releaseMs: number
}

/**
 * Keeps the selected building steady while GPS and compass jitter: switches only to a building
 * that has been the `likely` winner for `holdMs`, and drops the selection only after `releaseMs`
 * without any clear winner. A manual choice is never overridden automatically.
 */
export class SelectionStabilizer {
  private selected: number | null = null
  private manual = false
  private pendingId: number | null = null
  private pendingSince = 0
  private lostSince: number | null = null

  constructor(private readonly options: StabilizerOptions = { holdMs: 800, releaseMs: 2000 }) {}

  get current(): Selection {
    return { id: this.selected, manual: this.manual }
  }

  update(result: MatchResult, now: number): Selection {
    if (this.manual) return this.current
    const proposal = result.status === 'likely' && result.best ? result.best.outline.id : null

    if (proposal !== null && proposal === this.selected) {
      this.pendingId = null
      this.lostSince = null
    } else if (proposal !== null) {
      this.lostSince = null
      if (this.pendingId !== proposal) {
        this.pendingId = proposal
        this.pendingSince = now
      }
      if (now - this.pendingSince >= this.options.holdMs) this.commit(proposal)
    } else {
      this.pendingId = null
      if (this.selected !== null) {
        this.lostSince ??= now
        if (now - this.lostSince >= this.options.releaseMs) {
          this.selected = null
          this.lostSince = null
        }
      }
    }
    return this.current
  }

  /** the player picked a building: hold it until release() */
  choose(id: number): Selection {
    this.selected = id
    this.manual = true
    this.pendingId = null
    this.lostSince = null
    return this.current
  }

  /** recognised by look (the camera frame): shown at once, still automatic — the player's choice wins */
  adopt(id: number): Selection {
    if (this.manual) return this.current
    this.selected = id
    this.pendingId = null
    this.lostSince = null
    return this.current
  }

  /** back to automatic selection */
  release(): Selection {
    this.manual = false
    this.selected = null
    this.pendingId = null
    this.lostSince = null
    return this.current
  }

  private commit(id: number): void {
    this.selected = id
    this.pendingId = null
  }
}
