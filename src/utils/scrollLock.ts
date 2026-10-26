import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Keeps the page behind a modal sheet from scrolling while the sheet is open. `overflow: hidden` on
 * the body is not enough in iOS WebKit, so the body is pinned (position: fixed at the current
 * scroll) and put back where it was afterwards. Counted: sheets opened over sheets share one lock.
 */
let locks = 0
let savedY = 0
let savedStyle = ''

export function lockScroll(): void {
  if (locks++ > 0 || typeof document === 'undefined') return
  savedY = window.scrollY
  const body = document.body
  savedStyle = body.getAttribute('style') ?? ''
  Object.assign(body.style, { position: 'fixed', top: `${-savedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' })
}

export function unlockScroll(): void {
  if (locks === 0 || --locks > 0 || typeof document === 'undefined') return
  const body = document.body
  if (savedStyle) body.setAttribute('style', savedStyle)
  else body.removeAttribute('style')
  // jsdom has no scrollTo; at the top there is nothing to restore anyway
  if (savedY) window.scrollTo(0, savedY)
}

/** The page behind changed (e.g. another player's profile): when the lock ends, stay at the top. */
export function scrollToTopAfterLock(): void {
  if (locks > 0) {
    savedY = 0
    document.body.style.top = '0px'
  } else if (window.scrollY !== 0) window.scrollTo(0, 0)
}

/** Locks the page scroll for the lifetime of the calling component (a sheet / modal). */
export function useScrollLock(): void {
  onMounted(lockScroll)
  onBeforeUnmount(unlockScroll)
}
