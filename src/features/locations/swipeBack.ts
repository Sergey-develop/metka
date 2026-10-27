import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

/** a drag further than this (or a quick flick) leaves the page */
const LEAVE_PX = 80
const FLICK_PX_PER_MS = 0.5
/** sideways movement before the gesture is ours; until then a vertical scroll may still win */
const START_PX = 10

/** inside a horizontally scrolling strip (photos, chips) the finger scrolls the strip, not the page */
function inHorizontalScroller(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth) return true
  }
  return false
}

/**
 * A location page is swiped to the right to get back to the list of all locations, like iOS: the page
 * follows the finger and a long enough drag (or a flick) leaves. Back in history when the list is where
 * the player came from (its scroll is kept), else the list is opened. Vertical scrolling is untouched:
 * the page has touch-action: pan-y and the browser cancels the gesture once it scrolls.
 */
export function useSwipeBack() {
  const router = useRouter()
  const dx = ref(0)
  let start: { id: number; x: number; y: number; t: number } | null = null
  let active = false

  function leave(): void {
    const back = window.history.state?.back
    if (typeof back === 'string' && back.split('?')[0] === '/locations') router.back()
    else void router.push('/locations')
  }

  const handlers = {
    pointerdown(e: PointerEvent): void {
      if (e.pointerType === 'mouse' || inHorizontalScroller(e.target, e.currentTarget as Element)) return
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
      active = false
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
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }
      dx.value = Math.max(0, x)
    },
    pointerup(e: PointerEvent): void {
      if (!start || e.pointerId !== start.id) return
      const flick = dx.value / Math.max(1, performance.now() - start.t) > FLICK_PX_PER_MS && dx.value > START_PX * 2
      const go = active && (dx.value > LEAVE_PX || flick)
      start = null
      active = false
      dx.value = 0
      if (go) leave()
    },
    pointercancel(): void {
      start = null
      active = false
      dx.value = 0
    },
  }

  const style = computed(() =>
    dx.value > 0 ? { transform: `translateX(${dx.value}px)`, transition: 'none', boxShadow: '-8px 0 24px rgb(0 0 0 / 12%)' } : undefined,
  )

  return { handlers, style, dragging: computed(() => dx.value > 0) }
}
