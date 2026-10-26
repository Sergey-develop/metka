import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BottomSheet from '@/components/ui/BottomSheet.vue'

const H = 800

function sheet() {
  return mount(BottomSheet, { props: { label: 'Задания' }, slots: { default: '<p>Содержимое</p>' }, attachTo: document.body })
}
const FULL = H - 12
/** visible height: the panel is always full height and pushed down by --offset */
const height = (w: ReturnType<typeof sheet>) => {
  const offset = parseFloat((w.find('.bsheet__body').element as HTMLElement).style.getPropertyValue('--offset'))
  return `${FULL - offset}px`
}

// a controllable clock: drags are slow unless a test makes them a flick
let now = 0
async function dragGrip(w: ReturnType<typeof sheet>, from: number, to: number, stepMs = 200) {
  const grip = w.find('.bsheet__grip')
  await grip.trigger('pointerdown', { clientY: from, pointerId: 1 })
  now += stepMs
  await grip.trigger('pointermove', { clientY: (from + to) / 2, pointerId: 1 })
  now += stepMs
  await grip.trigger('pointermove', { clientY: to, pointerId: 1 })
  now += stepMs
  await grip.trigger('pointerup', { clientY: to, pointerId: 1 })
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: H, configurable: true })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

describe('BottomSheet', () => {
  it('one swipe up expands the sheet and, past the top, scrolls the content', async () => {
    const w = sheet()
    const content = w.find('.bsheet__content')
    const touch = (type: string, y: number) =>
      content.trigger(type, type === 'touchend' ? { changedTouches: [{ clientY: y }] } : { touches: [{ clientY: y }] })
    await touch('touchstart', 700)
    now += 100
    await touch('touchmove', 600)
    now += 100
    await touch('touchmove', 300) // 300px up: past the full height (788 − 536 = 252px)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    expect(height(w)).toBe(`${FULL}px`) // no rubber band: the rest goes into the content
    now += 100
    await touch('touchend', 300)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    expect(height(w)).toBe(`${FULL}px`)
    w.unmount()
  })

  it('opens to the mockup height (top edge at a third of the screen)', async () => {
    const w = sheet()
    await w.vm.$nextTick()
    expect(height(w)).toBe(`${Math.round(H * 0.67)}px`)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('a swipe up expands it to the whole screen, a swipe down collapses it back', async () => {
    const w = sheet()
    await dragGrip(w, 300, 150)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    expect(height(w)).toBe(`${FULL}px`)
    await dragGrip(w, 100, 250)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('false')
    expect(w.emitted('close')).toBeUndefined()
    w.unmount()
  })

  it('follows the finger while dragging', async () => {
    const w = sheet()
    const grip = w.find('.bsheet__grip')
    await grip.trigger('pointerdown', { clientY: 300, pointerId: 1 })
    await grip.trigger('pointermove', { clientY: 200, pointerId: 1 })
    expect(height(w)).toBe(`${Math.round(H * 0.67) + 100}px`)
    w.unmount()
  })

  it('a quick flick switches the size even when short', async () => {
    const w = sheet()
    await dragGrip(w, 300, 270, 5) // 30 px (under the switch distance) in 10 ms
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    await dragGrip(w, 100, 130, 5)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('false')
    await dragGrip(w, 300, 330, 5) // collapsed: a flick down closes it
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('pulled far down, it closes; a short pull down keeps it open', async () => {
    const w = sheet()
    await dragGrip(w, 300, 350)
    expect(w.emitted('close')).toBeUndefined()
    await dragGrip(w, 300, 500)
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('a tap on the grip toggles the size; Esc and the backdrop close', async () => {
    const w = sheet()
    await dragGrip(w, 300, 301)
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    await w.find('.bsheet').trigger('keydown', { key: 'Escape' })
    await w.find('.bsheet').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
    w.unmount()
  })

  it('tells the parent once it has settled at full height, with the content scroll', async () => {
    vi.useFakeTimers()
    const w = sheet()
    await dragGrip(w, 300, 150)
    expect(w.emitted('expanded')).toBeUndefined() // still snapping
    vi.advanceTimersByTime(400)
    expect(w.emitted('expanded')).toEqual([[0]])
    vi.useRealTimers()
    w.unmount()
  })

  it('the backdrop (the page header) appears with the sheet: hidden at half, following the finger, full at the top', async () => {
    const w = mount(BottomSheet, { props: { label: 'Задания' }, slots: { backdrop: '<div class="hdr" />' }, attachTo: document.body })
    await w.vm.$nextTick()
    const opacity = () => Number((w.find('.bsheet__backdrop').element as HTMLElement).style.opacity)
    expect(opacity()).toBe(0)
    const grip = w.find('.bsheet__grip')
    const half = Math.round(H * 0.67)
    await grip.trigger('pointerdown', { clientY: 400, pointerId: 1 })
    now += 200
    await grip.trigger('pointermove', { clientY: 400 - (FULL - half) / 2, pointerId: 1 }) // halfway up
    expect(opacity()).toBeCloseTo(0.5, 1)
    now += 200
    await grip.trigger('pointermove', { clientY: 400 - (FULL - half), pointerId: 1 })
    now += 200
    await grip.trigger('pointerup', { clientY: 400 - (FULL - half), pointerId: 1 })
    expect(opacity()).toBe(1)
    w.unmount()
  })

  it('topRoom: the expanded sheet stops where the page it becomes has its white body', async () => {
    const w = mount(BottomSheet, { props: { label: 'Клан', topRoom: 108 }, attachTo: document.body })
    await dragGrip(w, 300, 150)
    const offset = parseFloat((w.find('.bsheet__body').element as HTMLElement).style.getPropertyValue('--offset'))
    expect(offset).toBe(0)
    expect((w.find('.bsheet__body').element as HTMLElement).style.height).toBe(`${H - 108}px`)
    w.unmount()
  })
})
