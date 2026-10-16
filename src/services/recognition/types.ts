import type { GeoFix } from '../geolocation/types'

/** Minimal ImageData shape so pure functions are testable without a canvas. */
export interface PixelBuffer {
  width: number
  height: number
  /** RGBA, 8 bits per channel */
  data: Uint8ClampedArray
}

export type QualityIssue = 'blurry' | 'too_dark' | 'overexposed'

export interface ImageQuality {
  /** variance of the Laplacian on a grayscale downsample; higher = sharper */
  blurScore: number
  /** mean luma, 0..255 */
  brightness: number
  issues: QualityIssue[]
}

export interface RecognitionCandidate {
  buildingId: string
  name: string
  /** cosine similarity, 0..1 */
  score: number
  distanceM: number
}

export type RecognitionStatus =
  | 'recognized' // target is the best candidate with enough score and margin
  | 'ambiguous' // target leads but not clearly
  | 'other_building' // a different catalog building matches better
  | 'not_recognized' // nothing matches well enough
  | 'poor_quality' // photo rejected before inference
  | 'unavailable' // no recognition model configured on this build

export interface RecognitionDiagnostics {
  durationMs: number
  inferenceMs: number | null
  imageWidth: number
  imageHeight: number
  modelVersion: string | null
}

/**
 * Output of the ML pipeline. It is a signal for the UI and the server, never a
 * reward decision: the server re-matches the embedding itself.
 */
export interface RecognitionResult {
  status: RecognitionStatus
  targetBuildingId: string
  candidates: RecognitionCandidate[]
  /** score of the target building, null if it is not among candidates */
  confidence: number | null
  /** target score minus the best other candidate score */
  margin: number | null
  embedding: Float32Array | null
  modelVersion: string | null
  quality: ImageQuality | null
  diagnostics: RecognitionDiagnostics
}

export interface RecognitionInput {
  image: Blob
  targetBuildingId: string
  location: GeoFix
}

export interface RecognitionOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export type RecognitionErrorCode = 'timeout' | 'aborted' | 'decode_failed' | 'inference_failed' | 'matching_failed'

export class RecognitionError extends Error {
  constructor(
    readonly code: RecognitionErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'RecognitionError'
  }
}

export interface BuildingRecognitionService {
  /** Whether a real model is configured for this build. */
  isAvailable(): boolean
  recognize(input: RecognitionInput, options?: RecognitionOptions): Promise<RecognitionResult>
}

// ---- ports used by the recognition pipeline --------------------------------

export interface ModelManifest {
  version: string
  modelUrl: string
  inputSize: number
  embeddingDim: number
  mean: [number, number, number]
  std: [number, number, number]
  scoreThreshold: number
  marginThreshold: number
}

export interface EmbeddingModel {
  readonly manifest: ModelManifest
  /** input: CHW float tensor of size 3 * inputSize * inputSize; returns an L2-normalised vector */
  embed(tensor: Float32Array, signal?: AbortSignal): Promise<Float32Array>
}

export interface DecodedImage {
  /** small grayscale-friendly buffer for quality checks */
  analysis: PixelBuffer
  /** square center-cropped buffer at the model input size */
  modelInput: PixelBuffer | null
  originalWidth: number
  originalHeight: number
}

export interface ImageDecoder {
  decode(image: Blob, modelInputSize: number | null): Promise<DecodedImage>
}

export interface CandidateMatcher {
  match(
    query: { embedding: Float32Array; modelVersion: string; lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<RecognitionCandidate[]>
}
