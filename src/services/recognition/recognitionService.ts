import { AbortError, TimeoutError, withTimeout } from '../shared'
import { decideCandidates } from './decision'
import { assessQuality, toChwTensor } from './imageMath'
import {
  RecognitionError,
  type BuildingRecognitionService,
  type CandidateMatcher,
  type EmbeddingModel,
  type ImageDecoder,
  type RecognitionInput,
  type RecognitionOptions,
  type RecognitionResult,
} from './types'

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * On-device embedding + server-side candidate matching (ADR-001).
 * Model loading is lazy; `loadModel` returns null when no model is configured.
 */
export class EmbeddingRecognitionService implements BuildingRecognitionService {
  private modelPromise: Promise<EmbeddingModel | null> | null = null

  constructor(
    private readonly deps: {
      loadModel: (() => Promise<EmbeddingModel | null>) | null
      decoder: ImageDecoder
      matcher: CandidateMatcher
      now?: () => number
    },
  ) {}

  isAvailable(): boolean {
    return this.deps.loadModel !== null
  }

  async recognize(input: RecognitionInput, options: RecognitionOptions = {}): Promise<RecognitionResult> {
    const now = this.deps.now ?? (() => performance.now())
    const started = now()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const signal = options.signal

    try {
      return await withTimeout(this.run(input, signal, started, now), timeoutMs, signal)
    } catch (error) {
      if (error instanceof RecognitionError) throw error
      if (error instanceof TimeoutError) throw new RecognitionError('timeout', error.message)
      if (error instanceof AbortError || signal?.aborted) throw new RecognitionError('aborted')
      throw new RecognitionError('inference_failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async getModel(): Promise<EmbeddingModel | null> {
    if (!this.deps.loadModel) return null
    this.modelPromise ??= this.deps.loadModel().catch((error: unknown) => {
      this.modelPromise = null // allow retry after a failed download
      throw error
    })
    return this.modelPromise
  }

  private async run(
    input: RecognitionInput,
    signal: AbortSignal | undefined,
    started: number,
    now: () => number,
  ): Promise<RecognitionResult> {
    const model = await this.getModel()
    const manifest = model?.manifest ?? null

    let decoded
    try {
      decoded = await this.deps.decoder.decode(input.image, manifest?.inputSize ?? null)
    } catch (error) {
      throw new RecognitionError('decode_failed', error instanceof Error ? error.message : String(error))
    }
    if (signal?.aborted) throw new AbortError()

    const base = {
      targetBuildingId: input.targetBuildingId,
      candidates: [],
      confidence: null,
      margin: null,
      embedding: null,
      modelVersion: manifest?.version ?? null,
    } satisfies Partial<RecognitionResult>
    const diagnostics = (inferenceMs: number | null) => ({
      durationMs: Math.round(now() - started),
      inferenceMs,
      imageWidth: decoded.originalWidth,
      imageHeight: decoded.originalHeight,
      modelVersion: manifest?.version ?? null,
    })

    const quality = assessQuality(decoded.analysis)
    if (quality.issues.length > 0) {
      return { ...base, status: 'poor_quality', quality, diagnostics: diagnostics(null) }
    }
    if (!model || !manifest || !decoded.modelInput) {
      return { ...base, status: 'unavailable', quality, diagnostics: diagnostics(null) }
    }

    const inferenceStart = now()
    const embedding = await model.embed(toChwTensor(decoded.modelInput, manifest.mean, manifest.std), signal)
    const inferenceMs = Math.round(now() - inferenceStart)
    if (embedding.length !== manifest.embeddingDim) {
      throw new RecognitionError('inference_failed', `unexpected embedding size ${embedding.length}`)
    }

    let candidates
    try {
      candidates = await this.deps.matcher.match(
        { embedding, modelVersion: manifest.version, lat: input.location.lat, lng: input.location.lng },
        signal,
      )
    } catch (error) {
      if (signal?.aborted) throw new AbortError()
      throw new RecognitionError('matching_failed', error instanceof Error ? error.message : String(error))
    }

    const decision = decideCandidates(candidates, input.targetBuildingId, manifest)
    return {
      ...base,
      ...decision,
      candidates,
      embedding,
      quality,
      diagnostics: diagnostics(inferenceMs),
    }
  }
}
