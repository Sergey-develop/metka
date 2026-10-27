import type { StepOutcome } from '@/stores/areaQuests'
import { formatDistance } from '@/utils/geo'

/** Texts for the result of a route step or a check-in. */
const NO_POSITION: Record<string, string> = {
  permission_denied: 'Разреши доступ к геолокации, чтобы отметиться на месте.',
  disabled: 'Включи геолокацию на телефоне.',
  timeout: 'Не удалось определить место. Выйди на открытое место и попробуй ещё раз.',
  unavailable: 'Не удалось определить место. Попробуй ещё раз.',
}

export function message(o: StepOutcome): string {
  switch (o.kind) {
    case 'done':
      return o.xp > 0 ? 'Задание выполнено!' : 'Задание уже выполнено.'
    case 'too_far':
      return `До точки ещё ${formatDistance(o.distanceM)}. Подойди ближе и попробуй снова.`
    case 'wrong_answer':
      return 'Не совсем так. Попробуй другой ответ.'
    case 'no_position':
      return NO_POSITION[o.code] ?? NO_POSITION.unavailable!
    case 'camera':
      return 'Не удалось открыть камеру. Попробуй ещё раз.'
    case 'error':
      return o.error.code === 'offline' ? 'Нет сети. Попробуй ещё раз.' : 'Не получилось отправить. Попробуй ещё раз.'
  }
}

/** «+30 опыта», «Новый артефакт: …» under a fresh success */
export function rewardLines(o: StepOutcome): string[] {
  if (o.kind !== 'done' || o.xp === 0) return []
  return [
    `+${o.xp} опыта${o.coins > 0 ? ` · +${o.coins} монет` : ''}`,
    ...o.artifacts.map((a) => `Новый артефакт: «${a.title}»`),
  ]
}
