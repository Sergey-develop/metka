import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPhoto = vi.fn()
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (...a: unknown[]) => getPhoto(...a) },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Camera: 'CAMERA' },
  CameraErrorCode: { CameraPermissionDenied: 'OS-PLUG-CAMR-0003', NoCameraAvailable: 'OS-PLUG-CAMR-0007', TakePhotoCancelled: 'OS-PLUG-CAMR-0006' },
}))

const { CapacitorCameraService } = await import('@/services/camera/capacitorCamera')
const { CameraError } = await import('@/services/camera/types')

beforeEach(() => {
  getPhoto.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
})

describe('CapacitorCameraService', () => {
  it('asks the camera for base64 (no local file the remote site could not read) and makes a blob of it', async () => {
    getPhoto.mockResolvedValue({ base64String: btoa('JPEGDATA'), format: 'jpeg' })
    const photo = await new CapacitorCameraService().takePhoto()
    expect(getPhoto).toHaveBeenCalledWith(expect.objectContaining({ resultType: 'base64', source: 'CAMERA', saveToGallery: false }))
    expect(photo.blob.type).toBe('image/jpeg')
    expect(await photo.blob.text()).toBe('JPEGDATA')
    expect(photo.previewUrl).toBe('blob:preview')
  })

  it('maps a cancelled shot and an empty result', async () => {
    getPhoto.mockRejectedValueOnce(Object.assign(new Error('User cancelled photos app'), { code: 'OS-PLUG-CAMR-0006' }))
    await expect(new CapacitorCameraService().takePhoto()).rejects.toMatchObject({ code: 'cancelled' })
    getPhoto.mockResolvedValueOnce({ format: 'jpeg' })
    const e = await new CapacitorCameraService().takePhoto().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(CameraError)
    expect((e as InstanceType<typeof CameraError>).code).toBe('failed')
  })
})
