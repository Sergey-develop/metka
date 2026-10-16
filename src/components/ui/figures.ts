import { AVATAR_KEYS, type AvatarKey } from '@/types/game'

/**
 * Brand pictograms (runner, scooter, skater, cyclist) on a 32×32 grid.
 * `body` is stroked thick (the person), `gear` thin (the vehicle), `head` is a filled square.
 * Also used as preset avatars: the keys are `profiles.avatar_key` values.
 */
export const FIGURE_KEYS = AVATAR_KEYS
export type FigureKey = AvatarKey

export interface FigureShape {
  head: { x: number; y: number }
  body: string
  gear?: string
  wheels?: Array<{ cx: number; cy: number; r: number }>
}

export const FIGURES: Record<FigureKey, FigureShape> = {
  runner: {
    head: { x: 19, y: 3 },
    body: 'M18 10 L13 17 M18 10 L22 14 L26 13 M17 11 L12 10 L9 13 M13 17 L18 20 L16 27 M13 17 L9 23 L4 23',
  },
  scooter: {
    head: { x: 14, y: 3 },
    body: 'M15 10 L13 17 M15 11 L19 14 L23 12 M13 17 L16 21 L16 25 M13 17 L9 21 L6 22',
    gear: 'M22 9 L25 9 M24 9 L25.5 25 M7 25 L25.5 25',
    wheels: [
      { cx: 8.5, cy: 27.5, r: 2 },
      { cx: 25, cy: 27.5, r: 2 },
    ],
  },
  skater: {
    head: { x: 14, y: 3 },
    body: 'M15 10 L14 17 M15 10 L20 12 L23 11 M14 11 L10 14 L7 13 M14 17 L19 19 L19 23 M14 17 L11 20 L11 23',
    gear: 'M6 24 Q6.5 26 8 26 L22 26 Q23.5 26 24 24',
    wheels: [
      { cx: 10, cy: 28.5, r: 1.3 },
      { cx: 20, cy: 28.5, r: 1.3 },
    ],
  },
  cyclist: {
    head: { x: 16, y: 2 },
    body: 'M17 9 L13 15 M17 10 L21 13 L23 13 M13 15 L18 18 L16 23',
    gear: 'M8 23 L12 15 L21 16 L24 23 M12 15 L16 23 L21 16',
    wheels: [
      { cx: 8, cy: 23, r: 5.5 },
      { cx: 24, cy: 23, r: 5.5 },
    ],
  },
}

/** Brand tile per figure: the loader's background sequence and the avatar backgrounds. */
export const FIGURE_TONES: Record<FigureKey, { bg: string; fg: string }> = {
  runner: { bg: '#0a3ef5', fg: '#ffffff' },
  scooter: { bg: '#000000', fg: '#ffffff' },
  skater: { bg: '#f4f4f4', fg: '#000000' },
  cyclist: { bg: '#d4ffb5', fg: '#000000' },
}
