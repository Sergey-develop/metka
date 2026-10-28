/**
 * Reference embeddings of buildings from the owner's photos, for the camera scan (/scan).
 *   python -I tools/recognition/prepare.py <photos dir> <tensors dir>
 *   npm run recognition:build -- --tensors <tensors dir> --model <dinov2-small model_quantized.onnx>
 * The model is DINOv2 ViT-S/14 (Apache-2.0, ONNX int8 export Xenova/dinov2-small); the embedding is
 * the CLS token of last_hidden_state, L2-normalised — the same as src/services/scan/visualRecognizer.ts.
 * Writes public/recognition/zavidovo-v1/{model.onnx,references.json} and prints a leave-one-photo-out
 * check: each photo against the others, with the app's thresholds.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { tensors: { type: 'string' }, model: { type: 'string' } } })
if (!values.tensors || !values.model) {
  console.error('usage: npm run recognition:build -- --tensors <dir> --model <model.onnx>')
  process.exit(2)
}
const OUT = 'public/recognition/zavidovo-v1'
const SIZE = 224
/** chosen on the owner's 30 photos (2026-10-28): no photo of one building passes as another */
const SCORE_THRESHOLD = 0.75
const MARGIN_THRESHOLD = 0.04

type Ort = typeof import('onnxruntime-web')
const ort = createRequire(import.meta.url)('onnxruntime-web') as Ort
ort.env.wasm.numThreads = 1

const labels = JSON.parse(readFileSync('tools/recognition/labels.json', 'utf8')) as Record<string, { osm: string | null; name: string }>
const items = JSON.parse(readFileSync(`${values.tensors}/items.json`, 'utf8')) as { label: string; photo: string; tensor: string }[]
const session = await ort.InferenceSession.create(readFileSync(values.model))

const refs: { label: string; osm: string | null; e: number[] }[] = []
for (const item of items) {
  const meta = labels[item.label]
  if (!meta) throw new Error(`no label «${item.label}» in labels.json`)
  const bytes = readFileSync(`${values.tensors}/${item.tensor}`)
  const input = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const output = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
  const hidden = output.last_hidden_state!
  const dim = hidden.dims[2]!
  const cls = Array.from((hidden.data as Float32Array).subarray(0, dim))
  const norm = Math.hypot(...cls)
  refs.push({ label: meta.name, osm: meta.osm, e: cls.map((v) => Math.round((v / norm) * 1e5) / 1e5) })
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0)
let accepted = 0
let wrong = 0
for (const [i, q] of refs.entries()) {
  const best = new Map<string, number>()
  refs.forEach((r, j) => {
    if (j !== i) best.set(r.label, Math.max(best.get(r.label) ?? -1, dot(q.e, r.e)))
  })
  const [first, second] = [...best.entries()].sort((a, b) => b[1] - a[1])
  const ok = first![1] >= SCORE_THRESHOLD && first![1] - (second?.[1] ?? 0) >= MARGIN_THRESHOLD
  const target = refs.find((r) => r.label === first![0])!.osm
  if (ok && target !== null) {
    if (first![0] === q.label) accepted++
    else wrong++
  }
}
console.log(`leave-one-photo-out: ${refs.length} photos, recognised ${accepted}, wrong building ${wrong}`)

mkdirSync(OUT, { recursive: true })
copyFileSync(values.model, `${OUT}/model.onnx`)
writeFileSync(
  `${OUT}/references.json`,
  JSON.stringify({
    version: 'dinov2s-q8-zavidovo-v1',
    modelUrl: 'model.onnx',
    inputSize: SIZE,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scoreThreshold: SCORE_THRESHOLD,
    marginThreshold: MARGIN_THRESHOLD,
    references: refs,
  }),
)
console.log(`${refs.length} references -> ${OUT}`)
