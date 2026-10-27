import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useSwipeBack } from '@/features/locations/swipeBack'

const Page = defineComponent({
  setup() {
    const swipe = useSwipeBack()
    return () =>
      h('main', { class: 'page', style: swipe.style.value, onPointerdown: swipe.handlers.pointerdown, onPointermove: swipe.handlers.pointermove, onPointerup: swipe.handlers.pointerup }, [
        h('div', { class: 'strip', style: 'overflow-x: auto' }),
      ])
  },
})

async function open(from: string | null) {
  const stub = { template: '<div/>' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/locations', component: stub },
      { path: '/map', component: stub },
      { path: '/places/:id', component: Page },
    ],
  })
  if (from) await router.push(from)
  await router.push('/places/zav-bay')
  const w = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  const main = w.find('main')
  const at = async (type: string, x: number, y = 300, t = 0) => {
    vi.spyOn(performance, 'now').mockReturnValue(t)
    await main.trigger(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
  }
  return { router, w, main, at }
}

afterEach(() => vi.restoreAllMocks())

describe('useSwipeBack', () => {
  it('a long swipe right leaves for the locations list; the page follows the finger meanwhile', async () => {
    const { router, main, at } = await open('/map')
    await at('pointerdown', 20)
    await at('pointermove', 60, 302, 100)
    expect(main.attributes('style')).toContain('translateX(40px)')
    await at('pointermove', 160, 305, 400)
    await at('pointerup', 160, 305, 500)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/locations')
  })

  it('a short slow drag puts the page back; a vertical move is a scroll, not a swipe', async () => {
    const { router, main, at } = await open('/map')
    await at('pointerdown', 20)
    await at('pointermove', 70, 300, 300)
    await at('pointerup', 70, 300, 600)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-bay')
    expect(main.attributes('style') ?? '').not.toContain('translateX')

    await at('pointerdown', 20, 300)
    await at('pointermove', 30, 360, 100)
    await at('pointermove', 200, 380, 200)
    await at('pointerup', 200, 380, 300)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-bay')
  })

  it('a quick flick is enough', async () => {
    const { router, at } = await open('/map')
    await at('pointerdown', 20, 300, 0)
    await at('pointermove', 70, 300, 40)
    await at('pointerup', 70, 300, 60)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/locations')
  })
})
