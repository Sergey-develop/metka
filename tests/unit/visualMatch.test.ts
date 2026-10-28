import { describe, expect, it } from 'vitest'
import { SelectionStabilizer } from '@/services/scan/stabilizer'
import { osmKey, parseReferenceSet, referencedBuildings, visualVerdict, type VisualReferenceSet } from '@/services/scan/visualMatch'

const norm = (v: number[]) => {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
const RAW = {
  version: 'test-v1',
  modelUrl: 'model.onnx',
  inputSize: 224,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  scoreThreshold: 0.75,
  marginThreshold: 0.04,
  references: [
    { label: 'Эрбелия', osm: 'way/1', e: norm([1, 0, 0, 0]) },
    { label: 'Эрбелия', osm: 'way/1', e: norm([1, 0.2, 0, 0]) },
    { label: 'Рябина', osm: 'way/2', e: norm([0, 1, 0, 0]) },
    { label: 'Бухта', osm: null, place: 'zav-bay', e: norm([0, 0, 1, 0]) },
  ],
}
const set: VisualReferenceSet = parseReferenceSet(RAW, 'https://app.test/recognition/v1/references.json')
const frame = (v: number[]) => Float32Array.from(norm(v))
const BOTH = new Set(['way/1', 'way/2'])

describe('visual match', () => {
  it('parses the reference file and resolves the model next to it', () => {
    expect(set.modelUrl).toBe('https://app.test/recognition/v1/model.onnx')
    expect(set.references).toHaveLength(4)
    expect([...referencedBuildings(set)]).toEqual(['way/1', 'way/2'])
    expect(osmKey({ osmType: 'relation', osmId: 14440980 })).toBe('relation/14440980')
    expect(() => parseReferenceSet({ ...RAW, references: [{ label: 'x', osm: null, e: [1, 2] }, { label: 'y', osm: null, e: [1] }] }, 'https://a/')).toThrow()
    expect(() => parseReferenceSet({ ...RAW, scoreThreshold: 2 }, 'https://a/')).toThrow()
  })

  it('a clear look-alike in view is recognised by its best photo', () => {
    const v = visualVerdict(frame([1, 0.1, 0, 0]), set, BOTH)
    expect(v).toMatchObject({ osm: 'way/1', label: 'Эрбелия' })
    expect(v!.score).toBeGreaterThan(0.99)
  })

  it('unsure: low score, a close runner-up, a building out of view, or most like a view that is no building', () => {
    expect(visualVerdict(frame([1, 1, 1, 3]), set, BOTH)).toBeNull() // like nothing
    expect(visualVerdict(frame([0.8, 1, 0, 0]), set, BOTH)).toBeNull() // between two corpuses (0.78 vs 0.77)
    expect(visualVerdict(frame([1, 0.1, 0, 0]), set, new Set(['way/2']))).toBeNull() // not in view
    expect(visualVerdict(frame([0.3, 0, 1, 0]), set, BOTH)).toBeNull() // the bay, the player not near it
    expect(visualVerdict(Float32Array.from([1, 0]), set, BOTH)).toBeNull() // another model's vector
  })

  it('the bay is recognised as its place when the player is near it', () => {
    expect(visualVerdict(frame([0.3, 0, 1, 0]), set, BOTH, new Set(['zav-bay']))).toMatchObject({ osm: null, place: 'zav-bay', label: 'Бухта' })
  })

  it('the stabilizer takes a building recognised by look at once, but never over the player’s choice', () => {
    const s = new SelectionStabilizer()
    expect(s.adopt(7)).toEqual({ id: 7, manual: false })
    s.choose(3)
    expect(s.adopt(7)).toEqual({ id: 3, manual: true })
  })
})
