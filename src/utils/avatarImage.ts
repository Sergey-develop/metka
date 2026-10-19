/** Clan avatars: limits match the `clan-avatars` bucket (migration 005). */
export const AVATAR_SIDE = 512
export const AVATAR_MAX_BYTES = 512 * 1024
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

export type AvatarImageError = 'not_image' | 'too_large' | 'unreadable'

export class AvatarImageFailure extends Error {
  constructor(readonly code: AvatarImageError) {
    super(code)
    this.name = 'AvatarImageFailure'
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Centre-crops a picked photo to a square, scales it to 512×512 and re-encodes it
 * (WebP, or JPEG where the browser can't encode WebP). Re-encoding also drops EXIF,
 * so the camera's GPS position never reaches the server.
 */
export async function prepareAvatarImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new AvatarImageFailure('not_image')
  if (file.size > MAX_SOURCE_BYTES) throw new AvatarImageFailure('too_large')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new AvatarImageFailure('unreadable')
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    if (side === 0) throw new AvatarImageFailure('unreadable')
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIDE
    canvas.height = AVATAR_SIDE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarImageFailure('unreadable')
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE)

    for (const quality of [0.85, 0.7, 0.55]) {
      // older Safari ignores the WebP request and returns PNG — fall back to JPEG then
      let blob = await toBlob(canvas, 'image/webp', quality)
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality)
      if (blob && blob.size <= AVATAR_MAX_BYTES) return blob
    }
    throw new AvatarImageFailure('too_large')
  } finally {
    bitmap.close()
  }
}

/** Album photos: limits match the `memory-photos` bucket (migration 010). */
export const MEMORY_PHOTO_SIDE = 1600
export const MEMORY_PHOTO_MAX_BYTES = 1536 * 1024

/**
 * Scales a photo so its longer side is at most 1600 px (no crop) and re-encodes it like avatars:
 * WebP or JPEG, which drops EXIF — including the GPS position of where the photo was taken.
 */
export async function prepareMemoryPhoto(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new AvatarImageFailure('not_image')
  if (file.size > MAX_SOURCE_BYTES) throw new AvatarImageFailure('too_large')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new AvatarImageFailure('unreadable')
  }
  try {
    if (bitmap.width === 0 || bitmap.height === 0) throw new AvatarImageFailure('unreadable')
    const scale = Math.min(1, MEMORY_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarImageFailure('unreadable')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.7, 0.55]) {
      let blob = await toBlob(canvas, 'image/webp', quality)
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality)
      if (blob && blob.size <= MEMORY_PHOTO_MAX_BYTES) return blob
    }
    throw new AvatarImageFailure('too_large')
  } finally {
    bitmap.close()
  }
}
