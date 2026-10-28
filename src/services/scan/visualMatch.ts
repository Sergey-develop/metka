/**
 * Which building the camera sees, by look: the frame's embedding against reference photos of a few
 * buildings (the owner's photos, tools/recognition). It only helps the scan screen pick among the
 * buildings GPS and the compass already put in view — it never unlocks anything. A view may also stand
 * for an area place without a footprint (the bay → «Главная бухта»), recognised when the player is near.
 *
 * Every reference takes part in the ranking, also those of far buildings and of views that are no
 * building (the bay, a look-alike without an outline): a frame most like any of those is not taken
 * for a nearby building. The winner must be allowed (in view), clear the score and beat the runner-up
 * by the margin.
 */

export interface VisualReference {
  /** building (or view) name, one per photo set */
  label: string
  /** 'way/123' of the OSM footprint; null — a view that is no game building */
  osm: string | null
  /** area_places id of a place this view shows (the bay); null — none */
  place: string | null
  embedding: Float32Array
}

export interface VisualReferenceSet {
  version: string
  modelUrl: string
  inputSize: number
  mean: [number, number, number]
  std: [number, number, number]
  scoreThreshold: number
  marginThreshold: number
  references: VisualReference[]
}

export interface VisualVerdict {
  /** 'way/123' of the building recognised, or null for a place */
  osm: string | null
  /** area_places id of the place recognised, or null for a building */
  place: string | null
  label: string
  score: number
  margin: number
}

export const osmKey = (o: { osmType: string; osmId: number }): string => `${o.osmType}/${o.osmId}`

const triple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const unit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1

/** Validates references.json; `modelUrl` is resolved against the file's URL. */
export function parseReferenceSet(json: unknown, url: string): VisualReferenceSet {
  if (typeof json !== 'object' || json === null) throw new Error('references must be an object')
  const r = json as Record<string, unknown>
  if (typeof r.version !== 'string' || typeof r.modelUrl !== 'string') throw new Error('references.version/modelUrl invalid')
  if (typeof r.inputSize !== 'number' || !Number.isInteger(r.inputSize) || r.inputSize <= 0) throw new Error('references.inputSize invalid')
  if (!triple(r.mean) || !triple(r.std) || r.std.some((s) => s === 0)) throw new Error('references.mean/std invalid')
  if (!unit(r.scoreThreshold) || !unit(r.marginThreshold)) throw new Error('references thresholds invalid')
  if (!Array.isArray(r.references) || r.references.length === 0) throw new Error('references.references invalid')
  let dim: number | null = null
  const references = r.references.map((item: unknown): VisualReference => {
    const ref = item as Record<string, unknown>
    const place = ref.place ?? null
    if (typeof ref.label !== 'string' || !(ref.osm === null || typeof ref.osm === 'string') || !(place === null || typeof place === 'string') || !Array.isArray(ref.e)) {
      throw new Error('reference invalid')
    }
    if (!ref.e.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error('reference embedding invalid')
    dim ??= ref.e.length
    if (ref.e.length !== dim || dim === 0) throw new Error('reference embeddings differ in size')
    return { label: ref.label, osm: ref.osm, place, embedding: Float32Array.from(ref.e as number[]) }
  })
  return {
    version: r.version,
    modelUrl: new URL(r.modelUrl, url).toString(),
    inputSize: r.inputSize,
    mean: r.mean,
    std: r.std,
    scoreThreshold: r.scoreThreshold,
    marginThreshold: r.marginThreshold,
    references,
  }
}

/** OSM keys of the buildings that have reference photos */
export function referencedBuildings(set: VisualReferenceSet): Set<string> {
  return new Set(set.references.flatMap((r) => (r.osm ? [r.osm] : [])))
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/** area places that have reference photos */
export function referencedPlaces(set: VisualReferenceSet): Set<string> {
  return new Set(set.references.flatMap((r) => (r.place ? [r.place] : [])))
}

/**
 * The building (or place) the frame shows, or null when unsure. Both vectors are L2-normalised.
 * `allowed` — OSM keys of the buildings that may be in view (GPS + compass); `places` — area places
 * the player is near.
 */
export function visualVerdict(
  embedding: Float32Array,
  set: VisualReferenceSet,
  allowed: ReadonlySet<string>,
  places: ReadonlySet<string> = new Set(),
): VisualVerdict | null {
  const best = new Map<string, { score: number; osm: string | null; place: string | null }>()
  for (const ref of set.references) {
    if (ref.embedding.length !== embedding.length) return null
    const score = cosine(embedding, ref.embedding)
    const seen = best.get(ref.label)
    if (!seen || score > seen.score) best.set(ref.label, { score, osm: ref.osm, place: ref.place })
  }
  const [first, second] = [...best.entries()].sort((a, b) => b[1].score - a[1].score)
  if (!first) return null
  const [label, { score, osm, place }] = first
  const margin = score - (second?.[1].score ?? 0)
  const inView = (osm !== null && allowed.has(osm)) || (place !== null && places.has(place))
  if (!inView) return null
  if (score < set.scoreThreshold || margin < set.marginThreshold) return null
  return { osm, place, label, score, margin }
}
