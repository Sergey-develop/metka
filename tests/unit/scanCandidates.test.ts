import { describe, expect, it } from 'vitest'
import { MATCH, rankCandidates, type MatchResult, type ScanPosition } from '@/services/scan/candidates'
import { SelectionStabilizer } from '@/services/scan/stabilizer'
import type { BuildingOutline } from '@/types/game'

const ORIGIN = { lat: 55.6534, lng: 37.6196 }
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111_320
const KY = 110_540
const ll = (x: number, y: number): [number, number] => [ORIGIN.lng + x / KX, ORIGIN.lat + y / KY]

/** axis-aligned footprint given in metres east/north of the player */
function rect(id: number, x0: number, y0: number, x1: number, y1: number): BuildingOutline {
  return {
    id,
    osmType: 'way',
    osmId: id,
    geometry: { type: 'Polygon', coordinates: [[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]] },
    name: `#${id}`,
    address: null,
    category: null,
    game: null,
  }
}

const at = (accuracyM = 5): ScanPosition => ({ ...ORIGIN, accuracyM })

describe('rankCandidates', () => {
  it('a single building straight ahead is likely, with the distance to its facade', () => {
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 10 }, [rect(1, -15, 40, 15, 60)])
    expect(r.status).toBe('likely')
    expect(r.best?.outline.id).toBe(1)
    expect(r.best?.distanceM).toBeCloseTo(40, 0)
  })

  it('a nearer building hides the one behind it', () => {
    const near = rect(1, -20, 30, 20, 45)
    const far = rect(2, -60, 80, 60, 100)
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 10 }, [far, near])
    expect(r.best?.outline.id).toBe(1)
    expect(r.candidates.find((c) => c.outline.id === 2)?.score ?? 0).toBeLessThan(0.3)
  })

  it('looking between two buildings is ambiguous, not a guess', () => {
    const left = rect(1, -30, 40, -1, 60)
    const right = rect(2, 1, 40, 30, 60)
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 10 }, [left, right])
    expect(r.status).toBe('ambiguous')
    expect(r.candidates.map((c) => c.outline.id).sort()).toEqual([1, 2])
    expect(r.margin).toBeLessThan(MATCH.minMargin)
  })

  it('rough GPS gives "inaccurate" even with a clear winner, and widens the cone', () => {
    const b = [rect(1, -15, 40, 15, 60)]
    const precise = rankCandidates(at(5), { deg: 0, accuracyDeg: 10 }, b)
    const rough = rankCandidates(at(60), { deg: 0, accuracyDeg: 10 }, b)
    expect(rough.status).toBe('inaccurate')
    expect(rough.coneDeg).toBeGreaterThan(precise.coneDeg)
  })

  it('a rough compass never yields "likely"', () => {
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 45 }, [rect(1, -40, 20, 40, 60)])
    expect(r.status).toBe('ambiguous')
  })

  it('without heading: no guess, nearby buildings sorted by distance', () => {
    const r = rankCandidates(at(), null, [rect(1, 50, 50, 70, 70), rect(2, 10, -10, 20, 10), rect(3, 500, 500, 520, 520)])
    expect(r.status).toBe('no_heading')
    expect(r.best).toBeNull()
    expect(r.nearby.map((n) => n.outline.id)).toEqual([2, 1])
  })

  it('looking at empty space is "none"', () => {
    const r = rankCandidates(at(), { deg: 180, accuracyDeg: 10 }, [rect(1, -15, 40, 15, 60)])
    expect(r.status).toBe('none')
    expect(r.candidates).toEqual([])
  })

  it('ignores the footprint the GPS fix falls into and looks out of it', () => {
    const around = rect(1, -10, -10, 10, 10)
    const ahead = rect(2, -15, 40, 15, 60)
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 10 }, [around, ahead])
    expect(r.insideId).toBe(1)
    expect(r.best?.outline.id).toBe(2)
    expect(r.nearby[0]).toMatchObject({ distanceM: 0 })
  })

  it('handles headings across north (359° vs 1°) and single-node buildings', () => {
    const node: BuildingOutline = { ...rect(5, 0, 0, 0, 0), geometry: { type: 'Point', coordinates: ll(0, 40) } }
    for (const deg of [359, 1]) {
      const r = rankCandidates(at(), { deg, accuracyDeg: 5 }, [node])
      expect(r.best?.outline.id).toBe(5)
    }
  })

  it('ignores buildings beyond the range', () => {
    const r = rankCandidates(at(), { deg: 0, accuracyDeg: 10 }, [rect(1, -15, MATCH.maxRangeM + 10, 15, MATCH.maxRangeM + 30)])
    expect(r.status).toBe('none')
  })
})

describe('SelectionStabilizer', () => {
  const A = rect(1, -15, 40, 15, 60)
  const B = rect(2, -15, 40, 15, 60)
  const likely = (o: BuildingOutline): MatchResult => ({
    status: 'likely',
    candidates: [{ outline: o, score: 0.9, distanceM: 40 }],
    best: { outline: o, score: 0.9, distanceM: 40 },
    margin: 0.9,
    coneDeg: 10,
    nearby: [],
    insideId: null,
  })
  const unclear: MatchResult = { ...likely(A), status: 'ambiguous' }
  const opts = { holdMs: 800, releaseMs: 2000 }

  it('selects only after the winner holds', () => {
    const s = new SelectionStabilizer(opts)
    expect(s.update(likely(A), 0).id).toBeNull()
    expect(s.update(likely(A), 500).id).toBeNull()
    expect(s.update(likely(A), 800).id).toBe(1)
  })

  it('short jitter (ambiguous frames, a flicker to another building) does not switch the card', () => {
    const s = new SelectionStabilizer(opts)
    s.update(likely(A), 0)
    s.update(likely(A), 800)
    expect(s.update(unclear, 900).id).toBe(1)
    expect(s.update(likely(B), 1000).id).toBe(1)
    expect(s.update(likely(A), 1300).id).toBe(1)
    expect(s.update(likely(B), 1400).id).toBe(1) // B restarted its hold at 1400
    expect(s.update(likely(B), 2100).id).toBe(1)
    expect(s.update(likely(B), 2200).id).toBe(2)
  })

  it('drops the selection after a while without a clear winner', () => {
    const s = new SelectionStabilizer(opts)
    s.update(likely(A), 0)
    s.update(likely(A), 800)
    expect(s.update(unclear, 1000).id).toBe(1)
    expect(s.update(unclear, 2900).id).toBe(1)
    expect(s.update(unclear, 3000).id).toBeNull()
  })

  it('a manual choice holds until released', () => {
    const s = new SelectionStabilizer(opts)
    expect(s.choose(2)).toEqual({ id: 2, manual: true })
    expect(s.update(likely(A), 0).id).toBe(2)
    expect(s.update(likely(A), 5000).id).toBe(2)
    expect(s.release()).toEqual({ id: null, manual: false })
    s.update(likely(A), 6000)
    expect(s.update(likely(A), 6800).id).toBe(1)
  })
})
