<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScrollLock } from '@/utils/scrollLock'

// the page behind stays still while this is open
useScrollLock()

/**
 * A sheet sliding up over the map (mockups «выдвигается клан», «выдвигаются задания»).
 * Opens to the mockup's height (the map stays visible above); a swipe up expands it to the whole
 * screen, a swipe down collapses it back and then closes it. The grip and the content (while it is
 * scrolled to the top) can be dragged; tapping the grip toggles the size; a quick flick counts even
 * when short. Esc or the backdrop closes.
 * The panel always has the full height and only moves (transform), so dragging and snapping never
 * re-lay out its content — that is what keeps it smooth.
 * `topRoom`: room (px below the safe area) left above the expanded sheet. A sheet that becomes a page
 * sets it to where that page's white body starts, so at the hand-over the two line up exactly.
 * Slot `backdrop` lies behind the sheet, above the map: the header of the page the sheet becomes. It
 * appears with the sheet's position — fading in and sliding down as the sheet goes up, like scrolling,
 * following the finger and snapping with the same curve — so at full height the screen already looks
 * like that page.
 * `expanded` is emitted once the sheet has settled at full height, with the content's scroll position
 * (the content can be scrolled meanwhile; the page opens at that scroll).
 * Slot `top` is outside the scrolling area (e.g. a crest rising above the edge).
 * Every slot gets `expanded`; the default slot also gets `expand()` (e.g. for a «more» chevron), so a
 * sheet can show its full content in place instead of opening a page.
 * Wrap it in <Transition name="sheet">.
 */
const props = withDefaults(defineProps<{ label: string; topRoom?: number }>(), { topRoom: 12 })
const emit = defineEmits<{ close: []; expanded: [scrollTop: number] }>()

// the mockups open the sheet with its top edge at a third of the screen
const HALF_SHARE = 0.67
// a drag shorter than this is a tap
const TAP_PX = 6
// a swipe this long switches the size
const SWITCH_PX = 40
// pulled this far below the half height, the sheet closes
const CLOSE_PX = 90
// px/ms: a flick this fast switches the size (or closes) whatever its length
const FLICK_SPEED = 0.5
// the snap animation (see .bsheet__body); after it the sheet rests at full height
const SNAP_MS = 380
// the backdrop slides this far down while it appears
const BACKDROP_SLIDE_PX = 28

const root = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)

const expanded = ref(false)
let expandTimer: ReturnType<typeof setTimeout> | null = null
watch(expanded, (on) => {
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = on ? setTimeout(() => emit('expanded', content.value?.scrollTop ?? 0), SNAP_MS) : null
})
const viewport = ref(0)
const safeTop = ref(0)
const halfH = computed(() => Math.round(viewport.value * HALF_SHARE))
const fullH = computed(() => Math.max(halfH.value, viewport.value - safeTop.value - props.topRoom))

/** visible height of the sheet while a finger holds it; null — resting at half or full */
const dragHeight = ref<number | null>(null)
let start: { y: number; height: number; expanded: boolean } | null = null
let moved = false
// the last two finger positions, for the flick speed
let samples: { y: number; t: number }[] = []

/** how far the full-height panel is pushed down: 0 — full screen */
const offset = computed(() => {
  const visible = dragHeight.value ?? (expanded.value ? fullH.value : halfH.value)
  return Math.max(0, fullH.value - visible)
})
const style = computed(() =>
  // through a variable, so the enter/leave transition (classes) can still move the panel
  viewport.value ? { height: `${fullH.value}px`, '--offset': `${offset.value}px` } : undefined,
)
/** 0 at the half height (and below), 1 at full height */
const progress = computed(() => {
  const span = fullH.value - halfH.value
  if (span <= 0) return expanded.value ? 1 : 0
  return Math.min(1, Math.max(0, (fullH.value - offset.value - halfH.value) / span))
})
const backdropStyle = computed(() => ({
  opacity: progress.value,
  transform: `translateY(${(progress.value - 1) * BACKDROP_SLIDE_PX}px)`,
}))

function expand(): void {
  expanded.value = true
}

function measure(): void {
  viewport.value = root.value?.clientHeight || window.innerHeight
  safeTop.value = probe.value?.offsetTop ?? 0
}

function begin(y: number): void {
  start = { y, height: expanded.value ? fullH.value : halfH.value, expanded: expanded.value }
  moved = false
  samples = [{ y, t: performance.now() }]
}

function follow(y: number): void {
  if (!start) return
  const dy = start.y - y // > 0 — up
  if (Math.abs(dy) > TAP_PX) moved = true
  let height = start.height + dy
  // a little resistance beyond the full height
  if (height > fullH.value) height = fullH.value + (height - fullH.value) * 0.2
  dragHeight.value = height
  samples = [...samples.slice(-1), { y, t: performance.now() }]
}

/** finger speed at release, px/ms; > 0 — upwards */
function speed(y: number): number {
  const first = samples[0]
  if (!first) return 0
  const dt = performance.now() - first.t
  return dt > 0 && dt < 120 ? (first.y - y) / dt : 0
}

function finish(y: number): void {
  if (!start) return
  const dy = start.y - y
  const v = speed(y)
  const wasExpanded = start.expanded
  const height = dragHeight.value ?? start.height
  start = null
  if (!moved) {
    dragHeight.value = null
    return
  }
  const flickDown = v < -FLICK_SPEED
  const flickUp = v > FLICK_SPEED
  if (height < halfH.value - CLOSE_PX || (!wasExpanded && flickDown)) {
    // keep the position: the sheet leaves from where the finger let it go
    emit('close')
    return
  }
  dragHeight.value = null
  if (!wasExpanded) expanded.value = dy > SWITCH_PX || flickUp
  else if (dy < -SWITCH_PX || flickDown) expanded.value = false
}

// grip: mouse and touch through pointer events
function onGripDown(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  begin(e.clientY)
}
function onGripMove(e: PointerEvent): void {
  if (start) follow(e.clientY)
}
function onGripUp(e: PointerEvent): void {
  const tap = start !== null && !moved
  finish(e.clientY)
  if (tap) expanded.value = !expanded.value
}

// content: touch only, so its own scrolling keeps working. Collapsed — the sheet takes every vertical
// swipe; expanded — only a pull down while the content is scrolled to the top.
// One gesture does both, as in Telegram: once a swipe up has brought the sheet to full height, the rest
// of it scrolls the content (the browser will not start its own scroll mid-touch, so it is done here,
// with inertia after the release).
let touchY: number | null = null
let owning = false
/** content scroll when the sheet reached full height in this touch; null — not reached */
let scrollBase: number | null = null
let overflowY = 0
function onTouchStart(e: TouchEvent): void {
  stopGlide()
  touchY = e.touches[0]?.clientY ?? null
  owning = false
  scrollBase = null
}

/** the part of an upward drag beyond the full height scrolls the content instead */
function followTouch(y: number): void {
  if (!start || start.expanded) return follow(y)
  const height = start.height + (start.y - y)
  if (height <= fullH.value && scrollBase === null) return follow(y)
  const el = content.value
  if (!el) return follow(y)
  if (scrollBase === null) {
    scrollBase = el.scrollTop
    overflowY = y
    // the full content (e.g. the page look of the tasks) appears as the sheet reaches the top
    expanded.value = true
  }
  const extra = overflowY - y
  if (extra < 0 && el.scrollTop <= 0) {
    // back down below the top: the sheet follows the finger again
    scrollBase = null
    expanded.value = false
    return follow(y)
  }
  moved = true
  dragHeight.value = fullH.value
  el.scrollTop = scrollBase + extra
  samples = [...samples.slice(-1), { y, t: performance.now() }]
}

let glideFrame = 0
function stopGlide(): void {
  if (glideFrame) cancelAnimationFrame(glideFrame)
  glideFrame = 0
}
/** keeps scrolling after the release at the finger's speed (px/ms, > 0 — content moves up), slowing down */
function glide(v: number): void {
  stopGlide()
  const el = content.value
  if (!el || Math.abs(v) < 0.05 || typeof requestAnimationFrame !== 'function') return
  let last = performance.now()
  const step = (now: number): void => {
    const dt = Math.min(32, now - last)
    last = now
    const before = el.scrollTop
    el.scrollTop = before + v * dt
    v *= Math.pow(0.95, dt / 16)
    glideFrame = Math.abs(v) > 0.02 && el.scrollTop !== before ? requestAnimationFrame(step) : 0
  }
  glideFrame = requestAnimationFrame(step)
}
function onTouchMove(e: TouchEvent): void {
  const y = e.touches[0]?.clientY
  if (touchY === null || y === undefined) return
  if (!owning) {
    const dy = touchY - y
    if (Math.abs(dy) < TAP_PX) return
    const atTop = (content.value?.scrollTop ?? 0) <= 0
    owning = !expanded.value ? dy > 0 || atTop : dy < 0 && atTop
    if (!owning) {
      touchY = null // let the content scroll for the rest of this touch
      return
    }
    begin(touchY)
  }
  e.preventDefault()
  followTouch(y)
}
function onTouchEnd(e: TouchEvent): void {
  if (owning && scrollBase !== null) {
    // the sheet got to the top and the content was scrolled: stay expanded, let the scroll coast
    const y = e.changedTouches[0]?.clientY ?? 0
    const v = speed(y)
    start = null
    dragHeight.value = null
    glide(v)
  } else if (owning) finish(e.changedTouches[0]?.clientY ?? 0)
  touchY = null
  owning = false
  scrollBase = null
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  // passive: false — the sheet must be able to stop the content from scrolling while it is dragged
  content.value?.addEventListener('touchmove', onTouchMove, { passive: false })
  body.value?.focus()
})
onBeforeUnmount(() => {
  if (expandTimer) clearTimeout(expandTimer)
  stopGlide()
  window.removeEventListener('resize', measure)
  content.value?.removeEventListener('touchmove', onTouchMove)
})
</script>

<template>
  <div ref="root" class="bsheet" role="dialog" aria-modal="true" :aria-label="label" @keydown.esc="emit('close')" @click.self="emit('close')">
    <span ref="probe" class="bsheet__probe" aria-hidden="true" />
    <div v-if="$slots.backdrop" class="bsheet__backdrop" :class="{ 'bsheet__backdrop--dragging': dragHeight !== null }" :style="backdropStyle" aria-hidden="true">
      <slot name="backdrop" :expanded="expanded" />
    </div>
    <div
      ref="body"
      class="bsheet__body"
      :class="{ 'bsheet__body--dragging': dragHeight !== null, 'bsheet__body--full': expanded }"
      :style="style"
      tabindex="-1"
    >
      <slot name="top" :expanded="expanded" />
      <button
        class="bsheet__grip"
        :aria-label="expanded ? 'Свернуть' : 'Развернуть на весь экран'"
        :aria-expanded="expanded"
        @pointerdown="onGripDown"
        @pointermove="onGripMove"
        @pointerup="onGripUp"
        @pointercancel="onGripUp"
      >
        <span aria-hidden="true" />
      </button>
      <div ref="content" class="bsheet__content" @touchstart.passive="onTouchStart" @touchend="onTouchEnd" @touchcancel="onTouchEnd">
        <slot :expanded="expanded" :expand="expand" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// soft landing without overshoot (iOS-like sheet)
$snap: cubic-bezier(0.22, 1, 0.36, 1);

.bsheet {
  position: fixed;
  inset: 0;
  // under the glass tab bar (BottomNav 20, its wash 19) on every page, like Telegram: the menu stays
  // usable over an open sheet; the content's bottom padding scrolls clear of it
  z-index: 18;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(17 19 23 / 25%);
}
// the page's header behind the sheet; moves with the sheet (same curve and duration as its snap)
.bsheet__backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  transition:
    opacity 0.38s $snap,
    transform 0.38s $snap;
  will-change: opacity, transform;
}
.bsheet__backdrop--dragging {
  transition: none;
}
.bsheet__probe {
  // measures the safe-area inset in px for the full height
  position: absolute;
  top: var(--safe-top);
  width: 0;
  height: 0;
}

// <Transition name="sheet">: backdrop fades, the panel slides up from the bottom edge
.sheet-enter-active,
.sheet-leave-active {
  transition: background-color 0.34s $snap;
  .bsheet__body {
    transition: transform 0.4s $snap;
  }
}
.sheet-leave-active {
  transition-duration: 0.26s;
  .bsheet__body {
    transition: transform 0.26s cubic-bezier(0.4, 0, 1, 1);
  }
}
.sheet-enter-from,
.sheet-leave-to {
  background-color: rgb(17 19 23 / 0%);
  .bsheet__body {
    transform: translateY(100%);
  }
}

.bsheet__body {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  height: 100%;
  border-radius: 24px 24px 0 0;
  background: #fff;
  outline: none;
  // full height, pushed down to the visible part; only the transform animates
  transform: translateY(var(--offset, 33%));
  // the same corners as the pages' white body, so the hand-over to a page does not show
  transition: transform 0.38s $snap;
  will-change: transform;
}
.bsheet__body--dragging {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .bsheet__body,
  .sheet-leave-active .bsheet__body,
  .bsheet__backdrop,
  .bsheet__body {
    transition-duration: 0.01s;
  }
}
.bsheet__grip {
  flex: none;
  display: grid;
  place-items: center;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  touch-action: none;
  cursor: grab;
  span {
    width: 36px;
    height: 5px;
    border-radius: 3px;
    background: #d1d1d6;
  }
}
.bsheet__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  // the glass tab bar stays on top of the sheet (the sheet lives inside the page's stacking context),
  // so the last item must scroll clear of it — the same bottom room as a page (main.scss .page)
  padding: 0 16px calc(var(--nav-height) + var(--safe-bottom) + 24px);
}
</style>
