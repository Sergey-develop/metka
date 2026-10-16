const KEY = 'metka.onboarding.v1'

/** Per-device convenience flag; losing it only shows the intro again. */
export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    return false
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, 'done')
  } catch {
    // storage unavailable (private mode): the intro will simply show again
  }
}
