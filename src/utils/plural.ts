/** Russian plural: plural(5, ['день', 'дня', 'дней']) → 'дней' */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «3 дня»; «— дней» while the number is unknown */
export const daysText = (n: number | null | undefined) =>
  n == null ? '— дней' : `${n.toLocaleString('ru-RU')} ${plural(n, ['день', 'дня', 'дней'])}`
