import { describe, expect, it, vi } from 'vitest'
import { useSwipeAway } from '@/features/map/swipeAway'

const at = (x: number, y: number) => ({ pointerId: 1, clientX: x, clientY: y, currentTarget: { setPointerCapture: vi.fn() } }) as unknown as PointerEvent

function gesture(dx: number, dy: number, options?: { down?: boolean }) {
  const onDismiss = vi.fn()
  const swipe = useSwipeAway(onDismiss, options)
  swipe.handlers.pointerdown(at(100, 100))
  swipe.handlers.pointermove(at(100 + dx, 100 + dy))
  const style = swipe.style.value
  swipe.handlers.pointerup(at(100 + dx, 100 + dy))
  return { onDismiss, swipe, style }
}

describe('useSwipeAway', () => {
  it('a tap is a tap: nothing is dismissed and its click goes through', () => {
    const { onDismiss, swipe } = gesture(3, 2)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(swipe.dragged()).toBe(false)
  })

  it('a swipe sideways or down dismisses; the card follows the finger meanwhile', () => {
    const right = gesture(120, 0)
    expect(right.onDismiss).toHaveBeenCalledOnce()
    expect(right.style?.transform).toBe('translate(120px, 0px)')
    expect(right.swipe.dragged()).toBe(true)
    expect(gesture(-90, 10).onDismiss).toHaveBeenCalledOnce()
    expect(gesture(0, 60).onDismiss).toHaveBeenCalledOnce()
  })

  it('a short drag or a drag up only moves the card and puts it back', () => {
    const short = gesture(40, 20)
    expect(short.onDismiss).not.toHaveBeenCalled()
    expect(short.swipe.dragged()).toBe(true) // its click must not open the place
    expect(short.swipe.style.value).toBeUndefined()
    expect(gesture(0, -200).onDismiss).not.toHaveBeenCalled()
  })

  it('sideways only (the route card): a drag down neither moves nor dismisses it; sideways still does', () => {
    const down = gesture(0, 200, { down: false })
    expect(down.onDismiss).not.toHaveBeenCalled()
    expect(down.style?.transform ?? 'translate(0px, 0px)').toBe('translate(0px, 0px)')
    const right = gesture(120, 60, { down: false })
    expect(right.onDismiss).toHaveBeenCalledOnce()
    expect(right.style?.transform).toBe('translate(120px, 0px)')
  })
})
