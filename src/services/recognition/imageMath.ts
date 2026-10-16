import type { ImageQuality, PixelBuffer, QualityIssue } from './types'

export const QUALITY_LIMITS = {
  minBlurScore: 40,
  minBrightness: 40,
  maxBrightness: 235,
} as const

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Blur (variance of 4-neighbour Laplacian) and mean brightness of an RGBA buffer. */
export function assessQuality(image: PixelBuffer, limits = QUALITY_LIMITS): ImageQuality {
  const { width, height, data } = image
  if (width < 3 || height < 3) {
    return { blurScore: 0, brightness: 0, issues: ['blurry'] }
  }
  const gray = new Float32Array(width * height)
  let sum = 0
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const y = luma(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0)
    gray[i] = y
    sum += y
  }
  const brightness = sum / gray.length

  let lapSum = 0
  let lapSqSum = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap =
        (gray[i - 1] ?? 0) + (gray[i + 1] ?? 0) + (gray[i - width] ?? 0) + (gray[i + width] ?? 0) - 4 * (gray[i] ?? 0)
      lapSum += lap
      lapSqSum += lap * lap
      n++
    }
  }
  const mean = lapSum / n
  const blurScore = lapSqSum / n - mean * mean

  const issues: QualityIssue[] = []
  if (brightness < limits.minBrightness) issues.push('too_dark')
  else if (brightness > limits.maxBrightness) issues.push('overexposed')
  if (blurScore < limits.minBlurScore) issues.push('blurry')
  return { blurScore, brightness, issues }
}

/** RGBA buffer -> normalised CHW float tensor. */
export function toChwTensor(
  image: PixelBuffer,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): Float32Array {
  const { width, height, data } = image
  const plane = width * height
  const out = new Float32Array(3 * plane)
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = ((data[p + c] ?? 0) / 255 - mean[c]!) / std[c]!
    }
  }
  return out
}

export function l2Normalize(vector: Float32Array): Float32Array {
  let sq = 0
  for (const v of vector) sq += v * v
  const norm = Math.sqrt(sq)
  if (!Number.isFinite(norm) || norm === 0) throw new Error('cannot normalise a zero or non-finite vector')
  return vector.map((v) => v / norm)
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
