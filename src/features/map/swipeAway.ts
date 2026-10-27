import { computed, ref } from 'vue'

const SWIPE_X = 80
const SWIPE_DOWN = 40
/** less than this is a tap, not a drag */
const TAP = 8

/**
 * A card at the bottom of the map that is swiped away sideways or down, like a notification.
 * Bind `handlers` and `style` to the card; a tap still reaches the buttons inside it.
 */
export function useSwipeAway(onDismiss: () => void) {
  const drag = ref<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null)
  let moved = false

  const handlers = {
    pointerdown(e: PointerEvent): void {
      drag.value = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
      moved = false
    },
    pointermove(e: PointerEvent): void {
      const d = drag.value
      if (!d || e.pointerId !== d.id) return
      d.dx = e.clientX - d.x
      d.dy = Math.max(0, e.clientY - d.y)
      // captured only once it is a drag, so a tap still lands on the button under the finger
      if (!moved && Math.hypot(d.dx, d.dy) > TAP) {
        moved = true
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }
    },
    pointerup(e: PointerEvent): void {
      const d = drag.value
      if (!d || e.pointerId !== d.id) return
      drag.value = null
      if (Math.abs(d.dx) > SWIPE_X || d.dy > SWIPE_DOWN) onDismiss()
    },
    pointercancel(): void {
      drag.value = null
    },
  }

  const style = computed(() => {
    const d = drag.value
    if (!d) return undefined
    const opacity = Math.max(0.3, 1 - Math.abs(d.dx) / 240 - d.dy / 120)
    return { transform: `translate(${d.dx}px, ${d.dy}px)`, opacity: String(opacity), transition: 'none' }
  })

  return {
    handlers,
    style,
    /** the last touch was a drag: its click must not open anything */
    dragged: () => moved,
  }
}
