import type { DecodedImage, ImageDecoder, PixelBuffer } from './types'

const ANALYSIS_SIDE = 256

function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  crop: { sx: number; sy: number; sw: number; sh: number },
): PixelBuffer {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2d canvas is not available')
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  return { width, height, data }
}

/** Decodes a photo with createImageBitmap + canvas (WebView and browsers). */
export class CanvasImageDecoder implements ImageDecoder {
  async decode(image: Blob, modelInputSize: number | null): Promise<DecodedImage> {
    const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
    try {
      const { width, height } = bitmap
      if (width === 0 || height === 0) throw new Error('empty image')
      const scale = Math.min(1, ANALYSIS_SIDE / Math.max(width, height))
      const analysis = draw(bitmap, Math.max(3, Math.round(width * scale)), Math.max(3, Math.round(height * scale)), {
        sx: 0,
        sy: 0,
        sw: width,
        sh: height,
      })
      let modelInput: PixelBuffer | null = null
      if (modelInputSize) {
        const side = Math.min(width, height)
        modelInput = draw(bitmap, modelInputSize, modelInputSize, {
          sx: (width - side) / 2,
          sy: (height - side) / 2,
          sw: side,
          sh: side,
        })
      }
      return { analysis, modelInput, originalWidth: width, originalHeight: height }
    } finally {
      bitmap.close()
    }
  }
}
