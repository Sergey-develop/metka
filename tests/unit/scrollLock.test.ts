import { afterEach, describe, expect, it } from 'vitest'
import { lockScroll, unlockScroll } from '@/utils/scrollLock'

describe('scroll lock', () => {
  afterEach(() => document.body.removeAttribute('style'))

  it('pins the page while a sheet is open and puts it back after the last one closes', () => {
    document.body.style.color = 'red' // the body's own style survives
    lockScroll()
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.overflow).toBe('hidden')
    lockScroll() // a sheet over a sheet
    unlockScroll()
    expect(document.body.style.position).toBe('fixed') // still one open
    unlockScroll()
    expect(document.body.style.position).toBe('')
    expect(document.body.style.color).toBe('red')
    unlockScroll() // extra unlock is harmless
    expect(document.body.style.position).toBe('')
  })
})
