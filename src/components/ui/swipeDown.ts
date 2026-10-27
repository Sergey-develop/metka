import { onBeforeUnmount } from 'vue'

/** a drag further than this (or a quick flick) closes the sheet */
const CLOSE_PX = 80
const FLICK_PX_PER_MS = 0.5
/** downward movement before the gesture is ours */
const START_PX = 8
const OUT_MS = 240

/**
 * A bottom sheet swiped down to close. Bind `handlers` to the sheet's panel (touch events: the panel
 * scrolls, so the gesture starts only at its top and then stops the scroll with preventDefault). The panel
 * follows the finger, written to its style once per frame (no Vue re-render); a long enough drag or a
 * flick slides it out and calls `close`, otherwise it slides back.
 */
export function useSwipeDown(close: () => void) {
  let panel: HTMLElement | null = null
  let backdrop: HTMLElement | null = null
  let start: { x: number; y: number; t: number; scrolled: boolean } | null = null
  let dragging = false
  let dy = 0
  let frame = 0

  function paint(): void {
    frame = 0
    if (!panel) return
    panel.style.transition = 'none'
    panel.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
    // the dimming lightens (not the whole sheet: the panel lies inside the backdrop)
    if (backdrop) backdrop.style.backgroundColor = dy > 0 ? `rgb(17 19 23 / ${(40 * Math.max(0.2, 1 - dy / 400)).toFixed(1)}%)` : ''
  }
  function settle(out: boolean): void {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (!panel) return
    const ease = out ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    panel.style.transition = `transform ${OUT_MS}ms ${ease}`
    // the panel is already moving: it leaves from where the finger let it go, not from the top
    panel.style.transform = out ? 'translateY(100%)' : ''
    if (backdrop) {
      backdrop.style.transition = `background-color ${OUT_MS}ms ease`
      backdrop.style.backgroundColor = out ? 'rgb(17 19 23 / 0%)' : ''
    }
  }

  const handlers = {
    touchstart(e: TouchEvent): void {
      const t = e.touches[0]
      if (!t || e.touches.length > 1) return
      panel = e.currentTarget as HTMLElement
      backdrop = panel.parentElement
      start = { x: t.clientX, y: t.clientY, t: performance.now(), scrolled: panel.scrollTop > 0 }
      dragging = false
      dy = 0
    },
    touchmove(e: TouchEvent): void {
      const t = e.touches[0]
      if (!start || !t) return
      const y = t.clientY - start.y
      if (!dragging) {
        // a scroll of the content, or sideways: not ours
        if (start.scrolled || y < START_PX || Math.abs(t.clientX - start.x) > y) return
        dragging = true
      }
      e.preventDefault() // the panel follows the finger instead of scrolling
      dy = Math.max(0, y - START_PX)
      if (!frame) frame = requestAnimationFrame(paint)
    },
    touchend(): void {
      if (!start) return
      const go = dragging && (dy > CLOSE_PX || (dy > START_PX && dy / Math.max(1, performance.now() - start.t) > FLICK_PX_PER_MS))
      const moved = dragging
      start = null
      dragging = false
      dy = 0
      if (go) {
        settle(true)
        close()
      } else if (moved) settle(false)
    },
    touchcancel(): void {
      const moved = dragging
      start = null
      dragging = false
      dy = 0
      if (moved) settle(false)
    },
  }

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { handlers }
}
