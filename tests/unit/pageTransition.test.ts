import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { markSheetHandoff, transitionFor } from '@/app/pageTransition'

const route = (rise?: boolean) => ({ meta: rise ? { rise } : {} }) as unknown as RouteLocationNormalized

describe('page transitions', () => {
  it('sheet-like pages rise, every other section fades in', () => {
    expect(transitionFor(route(true))).toBe('rise')
    expect(transitionFor(route())).toBe('fade')
  })

  it('a sheet handing over to its page wins once, then the usual rules apply again', () => {
    markSheetHandoff()
    expect(transitionFor(route(true))).toBe('handoff')
    expect(transitionFor(route(true))).toBe('rise')
  })
})
