import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decideCandidates } from '@/services/recognition/decision'
import { assessQuality, l2Normalize, sha256Hex, toChwTensor } from '@/services/recognition/imageMath'
import { createOnnxEmbeddingModel, parseManifest } from '@/services/recognition/onnxModel'
import { EmbeddingRecognitionService } from '@/services/recognition/recognitionService'
import type {
  CandidateMatcher,
  EmbeddingModel,
  ImageDecoder,
  ModelManifest,
  PixelBuffer,
} from '@/services/recognition/types'
import { RecognitionError } from '@/services/recognition/types'

function buffer(width: number, height: number, pixel: (x: number, y: number) => number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = pixel(x, y)
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  return { width, height, data }
}

const sharp = buffer(32, 32, (x, y) => ((x + y) % 2 === 0 ? 200 : 60))
const flat = buffer(32, 32, () => 128)
const dark = buffer(32, 32, (x, y) => ((x + y) % 2 === 0 ? 30 : 0))

const MANIFEST: ModelManifest = {
  version: 'test-v1',
  modelUrl: 'https://x/model.onnx',
  inputSize: 8,
  embeddingDim: 4,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  scoreThreshold: 0.8,
  marginThreshold: 0.1,
}

describe('image quality', () => {
  it('detects sharp, blurry and dark images', () => {
    expect(assessQuality(sharp).issues).toEqual([])
    expect(assessQuality(flat).issues).toEqual(['blurry'])
    expect(assessQuality(dark).issues).toContain('too_dark')
  })

  it('builds normalised CHW tensors', () => {
    const t = toChwTensor(buffer(2, 1, (x) => (x === 0 ? 255 : 0)), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
    expect(Array.from(t)).toEqual([1, -1, 1, -1, 1, -1])
  })

  it('normalises vectors and hashes blobs', async () => {
    expect(Array.from(l2Normalize(new Float32Array([3, 4])))).toEqual([0.6000000238418579, 0.800000011920929])
    expect(() => l2Normalize(new Float32Array([0, 0]))).toThrow()
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('candidate decision', () => {
  const t = { scoreThreshold: 0.8, marginThreshold: 0.1 }
  const c = (buildingId: string, score: number) => ({ buildingId, name: buildingId, score, distanceM: 1 })
  it('classifies outcomes like the server rule', () => {
    expect(decideCandidates([c('a', 0.9), c('b', 0.5)], 'a', t).status).toBe('recognized')
    expect(decideCandidates([c('a', 0.9), c('b', 0.85)], 'a', t).status).toBe('ambiguous')
    expect(decideCandidates([c('b', 0.95), c('a', 0.82)], 'a', t).status).toBe('other_building')
    expect(decideCandidates([c('a', 0.6)], 'a', t).status).toBe('not_recognized')
    expect(decideCandidates([], 'a', t)).toEqual({ status: 'not_recognized', confidence: null, margin: null })
  })
})

describe('EmbeddingRecognitionService', () => {
  const decoder = (analysis: PixelBuffer): ImageDecoder => ({
    decode: vi.fn(async () => ({ analysis, modelInput: buffer(8, 8, () => 100), originalWidth: 800, originalHeight: 600 })),
  })
  const model = (embed?: EmbeddingModel['embed']): EmbeddingModel => ({
    manifest: MANIFEST,
    embed: embed ?? (async () => new Float32Array([1, 0, 0, 0])),
  })
  const matcher = (): CandidateMatcher & { match: ReturnType<typeof vi.fn> } => ({
    match: vi.fn(async () => [{ buildingId: 'target', name: 'T', score: 0.92, distanceM: 20 }]),
  })
  const input = { image: new Blob(['x']), targetBuildingId: 'target', location: { lat: 1, lng: 2, accuracyM: 5, timestamp: 0 } }

  it('reports unavailable when no model is configured (no fake success)', async () => {
    const svc = new EmbeddingRecognitionService({ loadModel: null, decoder: decoder(sharp), matcher: matcher() })
    expect(svc.isAvailable()).toBe(false)
    const r = await svc.recognize(input)
    expect(r.status).toBe('unavailable')
    expect(r.embedding).toBeNull()
  })

  it('stops at poor quality before inference', async () => {
    const m = matcher()
    const embed = vi.fn(async () => new Float32Array(4))
    const svc = new EmbeddingRecognitionService({ loadModel: async () => model(embed), decoder: decoder(flat), matcher: m })
    const r = await svc.recognize(input)
    expect(r.status).toBe('poor_quality')
    expect(embed).not.toHaveBeenCalled()
    expect(m.match).not.toHaveBeenCalled()
  })

  it('recognises the target via the matcher and keeps diagnostics free of location', async () => {
    const m = matcher()
    const svc = new EmbeddingRecognitionService({ loadModel: async () => model(), decoder: decoder(sharp), matcher: m })
    const r = await svc.recognize(input)
    expect(r).toMatchObject({ status: 'recognized', confidence: 0.92, modelVersion: 'test-v1' })
    expect(m.match).toHaveBeenCalledWith(expect.objectContaining({ modelVersion: 'test-v1', lat: 1, lng: 2 }), undefined)
    expect(Object.keys(r.diagnostics).sort()).toEqual(['durationMs', 'imageHeight', 'imageWidth', 'inferenceMs', 'modelVersion'])
  })

  it('times out, aborts and maps matching failures', async () => {
    const slow = model(() => new Promise(() => undefined))
    const svc = new EmbeddingRecognitionService({ loadModel: async () => slow, decoder: decoder(sharp), matcher: matcher() })
    await expect(svc.recognize(input, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' })

    const controller = new AbortController()
    const pending = svc.recognize(input, { signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })

    const failing: CandidateMatcher = { match: async () => Promise.reject(new Error('fetch failed')) }
    const svc2 = new EmbeddingRecognitionService({ loadModel: async () => model(), decoder: decoder(sharp), matcher: failing })
    await expect(svc2.recognize(input)).rejects.toBeInstanceOf(RecognitionError)
    await expect(svc2.recognize(input)).rejects.toMatchObject({ code: 'matching_failed' })
  })

  it('maps decode failures', async () => {
    const bad: ImageDecoder = { decode: async () => Promise.reject(new Error('bad jpeg')) }
    const svc = new EmbeddingRecognitionService({ loadModel: async () => model(), decoder: bad, matcher: matcher() })
    await expect(svc.recognize(input)).rejects.toMatchObject({ code: 'decode_failed' })
  })
})

describe('ONNX adapter (real onnxruntime-web, tiny fixture model)', () => {
  it('validates manifests', () => {
    const m = parseManifest({ ...MANIFEST, modelUrl: 'model.onnx' }, 'https://cdn.example/models/v1/manifest.json')
    expect(m.modelUrl).toBe('https://cdn.example/models/v1/model.onnx')
    expect(() => parseManifest({ ...MANIFEST, std: [1, 0, 1] }, 'https://x/')).toThrow()
    expect(() => parseManifest({ ...MANIFEST, version: 'Bad Version' }, 'https://x/')).toThrow()
  })

  it('runs inference and returns an L2-normalised embedding', async () => {
    const ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = 1
    const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, '../fixtures/tiny-embedding.onnx')))
    const model = await createOnnxEmbeddingModel(ort, MANIFEST, bytes)
    // channel means (R,G,B) = (1, 2, 2) -> W -> [1, 2, 2, 5] -> normalised
    const tensor = new Float32Array(3 * 64)
    tensor.fill(1, 0, 64)
    tensor.fill(2, 64, 192)
    const e = await model.embed(tensor)
    const norm = Math.sqrt(1 + 4 + 4 + 25)
    expect(Array.from(e).map((v) => +v.toFixed(5))).toEqual([1, 2, 2, 5].map((v) => +(v / norm).toFixed(5)))
    await expect(model.embed(new Float32Array(5))).rejects.toThrow(/expected 192/)
  }, 30_000)
})
