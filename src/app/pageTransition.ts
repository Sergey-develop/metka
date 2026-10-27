import type { RouteLocationNormalized } from 'vue-router'

/**
 * How the tab layout animates the next page change:
 *   handoff — a sheet expanded into its page (clan, tasks, diary). By then the sheet's backdrop already
 *             shows the page's header and the sheet stops where the page's white body starts, so the
 *             change is a short cross-fade of (almost) the same picture; the page opens at the scroll
 *             the sheet's content had;
 *   rise    — pages that open like sheets (route meta `rise`: clan, tasks, diary) slide up softly;
 *   fade    — every other change: the new page fades in, the old one goes at once;
 *   none    — no animation: the old page already left by itself (markInstant, the swipe back).
 */
export type PageTransition = 'handoff' | 'rise' | 'fade' | 'none'

let handoffPending = false
let handoffScroll: number | null = null
let instantPending = false

/** Call right before navigating when the old page has already animated itself away (swipe back). */
export function markInstant(): void {
  instantPending = true
}

/** Call right before router.push from an expanded sheet, with its content's scroll position. */
export function markSheetHandoff(scrollTop = 0): void {
  handoffPending = true
  handoffScroll = scrollTop
}

/** The transition for this navigation (consumes the handoff mark). */
export function transitionFor(to: RouteLocationNormalized): PageTransition {
  if (instantPending) {
    instantPending = false
    return 'none'
  }
  if (handoffPending) {
    handoffPending = false
    return 'handoff'
  }
  return to.meta.rise ? 'rise' : 'fade'
}

/** Where the page opened by a hand-over starts scrolled (consumed once); null — not a hand-over. */
export function takeHandoffScroll(): number | null {
  const top = handoffScroll
  handoffScroll = null
  return top
}
