import { onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { parentPath } from '@/app/pageStack'
import { markInstant } from '@/app/pageTransition'

/** a drag further than this (or a quick flick) leaves the page */
const LEAVE_PX = 80
const FLICK_PX_PER_MS = 0.5
/** sideways movement before the gesture is ours; until then a vertical scroll may still win */
const START_PX = 10
const OUT_MS = 220
const BACK_MS = 250

/** inside a horizontally scrolling strip (photos, chips) the finger scrolls the strip, not the page */
function inHorizontalScroller(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth) return true
  }
  return false
}

/**
 * A page is swiped to the right to get back, like iOS: it follows the finger and a long enough drag (or a
 * flick) slides it out, then the page under it shows with no animation of its own. A page lying over the
 * map or the locations list goes back to it (in history when it is the previous page, so it keeps its
 * state); a page of its own goes back in history, else to `fallback`. The page needs touch-action: pan-y:
 * vertical scrolling stays the browser's, which cancels the gesture once it scrolls.
 *
 * The page is moved by writing its style once per frame, not through Vue state: a reactive offset
 * re-rendered the whole page on every finger move and made it stutter.
 */
export function useSwipeBack(fallback = '/locations') {
  const router = useRouter()
  const here = useRoute()
  let el: HTMLElement | null = null
  let start: { id: number; x: number; y: number; t: number } | null = null
  let active = false
  let dx = 0
  let frame = 0
  let leaving = false

  function paint(): void {
    frame = 0
    if (!el) return
    el.style.transition = 'none'
    el.style.transform = dx > 0 ? `translateX(${dx}px)` : ''
    el.style.boxShadow = dx > 0 ? '-8px 0 24px rgb(0 0 0 / 12%)' : ''
  }
  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(paint)
  }
  function settle(to: 'back' | 'out'): void {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (!el) return
    const ms = to === 'out' ? OUT_MS : BACK_MS
    el.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${ms}ms ease`
    if (to === 'out') {
      el.style.transform = 'translateX(100%)'
      el.style.opacity = '0.6'
    } else {
      el.style.transform = ''
      el.style.boxShadow = ''
    }
  }

  function leave(): void {
    leaving = true
    settle('out')
    setTimeout(() => {
      markInstant()
      // back to the page this one lies over (the map, the locations list) — in history when it is the
      // previous page, so it keeps its state; a page of its own goes back in history
      const parent = parentPath(here)
      const back = window.history.state?.back
      const prev = typeof back === 'string' ? back.split('?')[0] : null
      if (parent ? prev === parent : prev !== null) router.back()
      else void router.push(parent ?? fallback)
    }, OUT_MS)
  }

  const handlers = {
    pointerdown(e: PointerEvent): void {
      if (leaving || e.pointerType === 'mouse' || inHorizontalScroller(e.target, e.currentTarget as Element)) return
      el = e.currentTarget as HTMLElement
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
      active = false
      dx = 0
    },
    pointermove(e: PointerEvent): void {
      if (!start || e.pointerId !== start.id) return
      const x = e.clientX - start.x
      const y = e.clientY - start.y
      if (!active) {
        if (Math.abs(y) > Math.abs(x)) {
          start = null // a scroll, not ours
          return
        }
        if (x < START_PX) return
        active = true
        el?.setPointerCapture?.(e.pointerId)
      }
      dx = Math.max(0, x - START_PX) // from where it became a swipe: no jump at the start
      schedule()
    },
    pointerup(e: PointerEvent): void {
      if (!start || e.pointerId !== start.id) return
      const flick = dx / Math.max(1, performance.now() - start.t) > FLICK_PX_PER_MS && dx > START_PX
      const go = active && (dx > LEAVE_PX || flick)
      const moved = active
      start = null
      active = false
      dx = 0
      if (go) leave()
      else if (moved) settle('back')
    },
    pointercancel(): void {
      const moved = active
      start = null
      active = false
      dx = 0
      if (moved) settle('back')
    },
  }

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { handlers }
}
