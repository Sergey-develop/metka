import { l2Normalize, toChwTensor } from '../recognition/imageMath'
import { parseReferenceSet, type VisualReferenceSet } from './visualMatch'

/** reference photos of the Zavidovo corpuses and the DINOv2 model (tools/recognition) */
export const ZAVIDOVO_REFERENCES_URL = `${import.meta.env.BASE_URL}recognition/zavidovo-v1/references.json`

export interface VisualRecognizer {
  readonly set: VisualReferenceSet
  /** embedding of the current camera frame (its centre square), null when the video has no frame yet */
  embedFrame(video: HTMLVideoElement): Promise<Float32Array | null>
}

/**
 * Loads the references and the model (≈24 MB, ONNX Runtime WASM). Inference runs on the main thread
 * (WebViews are not cross-origin isolated): ≈0.25 s per frame on a PC, so callers keep it rare.
 */
export async function loadVisualRecognizer(url = ZAVIDOVO_REFERENCES_URL): Promise<VisualRecognizer> {
  const absolute = new URL(url, window.location.href).toString()
  const response = await fetch(absolute)
  if (!response.ok) throw new Error(`references HTTP ${response.status}`)
  const set = parseReferenceSet(await response.json(), absolute)

  const [ort, wasmUrl, modelResponse] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url').then((m: { default: string }) => m.default),
    fetch(set.modelUrl),
  ])
  if (!modelResponse.ok) throw new Error(`model HTTP ${modelResponse.status}`)
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  ort.env.wasm.numThreads = 1
  const session = await ort.InferenceSession.create(new Uint8Array(await modelResponse.arrayBuffer()))
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  if (!inputName || !outputName) throw new Error('model must have an input and an output')

  const size = set.inputSize
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2d canvas is not available')

  return {
    set,
    async embedFrame(video) {
      const w = video.videoWidth
      const h = video.videoHeight
      if (video.readyState < 2 || w === 0 || h === 0) return null
      // the centre square, as tools/recognition/prepare.py crops the reference photos
      const side = Math.min(w, h)
      ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size)
      const pixels = { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data }
      const tensor = toChwTensor(pixels, set.mean, set.std)
      const output = await session.run({ [inputName]: new ort.Tensor('float32', tensor, [1, 3, size, size]) })
      const hidden = output[outputName]
      const data = hidden?.data
      const dim = hidden?.dims[2]
      if (!(data instanceof Float32Array) || !dim) throw new Error('model output is not float32 [1, tokens, dim]')
      // DINOv2: the CLS token (first of last_hidden_state) is the image descriptor
      return l2Normalize(data.slice(0, dim))
    },
  }
}
