import { describe, expect, it, vi } from 'vitest'
import { BrowserScreenWakeLock } from '@/services/lifecycle/wakeLock'

function fakes() {
  const released = vi.fn(async () => undefined)
  let onRelease: (() => void) | null = null
  const api = {
    request: vi.fn(async () => ({
      release: released,
      addEventListener: (_t: 'release', l: () => void) => (onRelease = l),
    })),
  }
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }) as unknown as Document
  const setVisible = (v: boolean) => {
    Object.assign(doc, { visibilityState: v ? 'visible' : 'hidden' })
    doc.dispatchEvent(new Event('visibilitychange'))
  }
  return { api, doc, released, setVisible, systemRelease: () => onRelease?.() }
}

describe('BrowserScreenWakeLock', () => {
  it('keeps the screen on, releases on request', async () => {
    const f = fakes()
    const lock = new BrowserScreenWakeLock(f.api, f.doc)
    expect(await lock.keepOn()).toBe(true)
    expect(lock.active).toBe(true)
    expect(f.api.request).toHaveBeenCalledWith('screen')
    await lock.release()
    expect(f.released).toHaveBeenCalled()
    expect(lock.active).toBe(false)
  })

  it('takes the lock again when the page comes back (the browser drops it when hidden)', async () => {
    const f = fakes()
    const lock = new BrowserScreenWakeLock(f.api, f.doc)
    await lock.keepOn()
    f.setVisible(false)
    f.systemRelease()
    expect(lock.active).toBe(false)
    f.setVisible(true)
    await vi.waitFor(() => expect(lock.active).toBe(true))
    expect(f.api.request).toHaveBeenCalledTimes(2)
    await lock.release()
    f.setVisible(false)
    f.setVisible(true)
    await Promise.resolve()
    expect(f.api.request).toHaveBeenCalledTimes(2) // not wanted any more
  })

  it('unsupported or refused: reports false and never throws', async () => {
    expect(await new BrowserScreenWakeLock(null, fakes().doc).keepOn()).toBe(false)
    const f = fakes()
    f.api.request.mockRejectedValueOnce(new Error('NotAllowedError'))
    const lock = new BrowserScreenWakeLock(f.api, f.doc)
    expect(await lock.keepOn()).toBe(false)
    expect(lock.active).toBe(false)
  })
})
