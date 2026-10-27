import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useSwipeDown } from '@/components/ui/swipeDown'

function sheet() {
  const close = vi.fn()
  const Sheet = defineComponent({
    setup() {
      const swipe = useSwipeDown(close)
      return () =>
        h('div', { class: 'sheet' }, [
          h('div', {
            class: 'panel',
            onTouchstart: swipe.handlers.touchstart,
            onTouchmove: swipe.handlers.touchmove,
            onTouchend: swipe.handlers.touchend,
          }),
        ])
    },
  })
  const w = mount(Sheet)
  const panel = w.find('.panel').element as HTMLElement
  const touch = (type: string, y: number, t = 0) => {
    vi.spyOn(performance, 'now').mockReturnValue(t)
    const touches = type === 'touchend' ? [] : [{ clientX: 100, clientY: y }]
    panel.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches }))
  }
  return { close, panel, touch }
}

const frame = () => new Promise((r) => requestAnimationFrame(r))
afterEach(() => vi.restoreAllMocks())

describe('useSwipeDown', () => {
  it('the panel follows the finger down; a long drag slides it out and closes the sheet', async () => {
    const { close, panel, touch } = sheet()
    touch('touchstart', 100)
    touch('touchmove', 150, 100)
    await frame()
    expect(panel.style.transform).toBe('translateY(42px)') // 50 − the 8px it took to become a swipe
    touch('touchmove', 260, 400)
    touch('touchend', 260, 500)
    expect(panel.style.transform).toBe('translateY(100%)')
    expect(close).toHaveBeenCalledOnce()
  })

  it('a short slow drag puts the panel back; a scrolled panel scrolls instead of closing', async () => {
    const { close, panel, touch } = sheet()
    touch('touchstart', 100)
    touch('touchmove', 150, 300)
    touch('touchend', 150, 600)
    expect(close).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')

    panel.scrollTop = 120
    touch('touchstart', 100)
    touch('touchmove', 400, 100)
    touch('touchend', 400, 200)
    expect(close).not.toHaveBeenCalled()
  })
})
