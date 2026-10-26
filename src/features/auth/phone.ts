// Russian mobile numbers only (+7, the flag in the field): 10 national digits.

/** Extracts up to 10 national digits from typed or pasted text ("+7 999…", "8 999…", "999…"). */
export function ruPhoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1)
  return digits.slice(0, 10)
}

/**
 * "9991234567" → "(999) 123-45-67". Partial input is formatted as far as it goes and never ends with
 * a separator, so Backspace always removes a digit.
 */
export function formatRuPhone(digits: string): string {
  const d = digits.slice(0, 10)
  if (!d) return ''
  let out = `(${d.slice(0, 3)}`
  if (d.length > 3) out += `) ${d.slice(3, 6)}`
  if (d.length > 6) out += `-${d.slice(6, 8)}`
  if (d.length > 8) out += `-${d.slice(8, 10)}`
  return out
}

export function isCompleteRuPhone(digits: string): boolean {
  return /^\d{10}$/.test(digits)
}

/** E.164 for Supabase Auth */
export function ruPhoneE164(digits: string): string {
  return `+7${digits}`
}
