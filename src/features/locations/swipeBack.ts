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
 * state); a page of its own goes back in history, else to `fallback`.
 *
 * Touch events, not pointer events: on iOS a pointer gesture is cancelled as soon as Safari starts to
 * scroll, and a finger is never perfectly horizontal — the page jerked back. With touch events the
 * direction is decided after 10px, and from then on the move is ours (preventDefault, no scroll).
 *
 * The page is moved by writing its style once per frame, not through Vue state: a reactive offset
 * re-rendered the whole page on every finger move and made it stutter.
 */
export function useSwipeBack(fallback = '/locations') {
  const router = useRouter()
  const here = useRoute()
  let el: HTMLElement | null = null
  let start: { x: number; y: number; t: number } | null = null
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

  function end(): boolean {
    const moved = active
    start = null
    active = false
    dx = 0
    return moved
  }

  const handlers = {
    touchstart(e: TouchEvent): void {
      const t = e.touches[0]
      if (leaving || !t || e.touches.length > 1 || inHorizontalScroller(e.target, e.currentTarget as Element)) return
      el = e.currentTarget as HTMLElement
      start = { x: t.clientX, y: t.clientY, t: performance.now() }
      active = false
      dx = 0
    },
    touchmove(e: TouchEvent): void {
      const t = e.touches[0]
      if (!start || !t) return
      const x = t.clientX - start.x
      const y = t.clientY - start.y
      if (!active) {
        // decide once the finger has really moved: the first few pixels wobble both ways
        if (Math.hypot(x, y) < START_PX) return
        if (Math.abs(y) > Math.abs(x) || x <= 0) {
          start = null // a scroll (or a swipe to the left): the browser's
          return
        }
        active = true
      }
      // ours now: the page follows the finger and the browser must not scroll it under the finger (iOS
      // takes a slightly diagonal move for a scroll and would otherwise break the swipe off)
      e.preventDefault()
      dx = Math.max(0, x - START_PX) // from where it became a swipe: no jump at the start
      schedule()
    },
    touchend(): void {
      if (!start) return
      const flick = dx / Math.max(1, performance.now() - start.t) > FLICK_PX_PER_MS && dx > START_PX
      const go = active && (dx > LEAVE_PX || flick)
      const moved = end()
      if (go) leave()
      else if (moved) settle('back')
    },
    touchcancel(): void {
      if (end()) settle('back')
    },
  }

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { handlers }
}
