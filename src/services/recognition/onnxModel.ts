import type * as Ort from 'onnxruntime-web'
import { AbortError } from '../shared'
import { l2Normalize } from './imageMath'
import type { EmbeddingModel, ModelManifest } from './types'

type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>

function isTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1
}

/** Validates a model manifest JSON; `modelUrl` is resolved relative to the manifest URL. */
export function parseManifest(json: unknown, manifestUrl: string): ModelManifest {
  if (typeof json !== 'object' || json === null) throw new Error('model manifest must be an object')
  const m = json as Record<string, unknown>
  if (typeof m.version !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(m.version)) throw new Error('manifest.version invalid')
  if (typeof m.modelUrl !== 'string') throw new Error('manifest.modelUrl invalid')
  if (!positive(m.inputSize) || !Number.isInteger(m.inputSize)) throw new Error('manifest.inputSize invalid')
  if (!positive(m.embeddingDim) || !Number.isInteger(m.embeddingDim)) throw new Error('manifest.embeddingDim invalid')
  if (!isTriple(m.mean) || !isTriple(m.std) || m.std.some((s) => s === 0)) throw new Error('manifest.mean/std invalid')
  if (!unit(m.scoreThreshold) || !unit(m.marginThreshold)) throw new Error('manifest thresholds invalid')
  return {
    version: m.version,
    modelUrl: new URL(m.modelUrl, manifestUrl).toString(),
    inputSize: m.inputSize,
    embeddingDim: m.embeddingDim,
    mean: m.mean,
    std: m.std,
    scoreThreshold: m.scoreThreshold,
    marginThreshold: m.marginThreshold,
  }
}

/** Wraps an ONNX session as an EmbeddingModel (single input, first output = embedding). */
export async function createOnnxEmbeddingModel(
  ort: OrtModule,
  manifest: ModelManifest,
  modelBytes: Uint8Array,
): Promise<EmbeddingModel> {
  const session = await ort.InferenceSession.create(modelBytes)
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  if (!inputName || !outputName) throw new Error('model must have one input and one output')
  const size = manifest.inputSize
  let queue: Promise<unknown> = Promise.resolve()

  return {
    manifest,
    embed(tensor: Float32Array, signal?: AbortSignal): Promise<Float32Array> {
      if (tensor.length !== 3 * size * size) {
        return Promise.reject(new Error(`expected ${3 * size * size} values, got ${tensor.length}`))
      }
      // ORT sessions are not re-entrant: serialise runs
      const run = queue.then(async () => {
        if (signal?.aborted) throw new AbortError()
        const output = await session.run({ [inputName]: new ort.Tensor('float32', tensor, [1, 3, size, size]) })
        if (signal?.aborted) throw new AbortError()
        const data = output[outputName]?.data
        if (!(data instanceof Float32Array)) throw new Error('model output is not float32')
        return l2Normalize(data)
      })
      queue = run.catch(() => undefined)
      return run
    },
  }
}

/** Browser/WebView loader: fetches the manifest and model, initialises ORT (WASM). */
export async function loadOnnxModelFromUrl(manifestUrl: string): Promise<EmbeddingModel> {
  const manifestResponse = await fetch(manifestUrl)
  if (!manifestResponse.ok) throw new Error(`model manifest HTTP ${manifestResponse.status}`)
  const manifest = parseManifest(await manifestResponse.json(), manifestUrl)

  const [ort, wasmUrl, modelResponse] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url').then((m: { default: string }) => m.default),
    fetch(manifest.modelUrl),
  ])
  if (!modelResponse.ok) throw new Error(`model HTTP ${modelResponse.status}`)
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  // WebViews are not cross-origin isolated, so SharedArrayBuffer threads are unavailable
  ort.env.wasm.numThreads = 1
  return createOnnxEmbeddingModel(ort, manifest, new Uint8Array(await modelResponse.arrayBuffer()))
}
