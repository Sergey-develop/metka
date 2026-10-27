import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { transitionFor } from '@/app/pageTransition'
import { useSwipeBack } from '@/features/locations/swipeBack'

const Page = defineComponent({
  setup() {
    const swipe = useSwipeBack()
    return () =>
      h('main', {
        class: 'page',
        onPointerdown: swipe.handlers.pointerdown,
        onPointermove: swipe.handlers.pointermove,
        onPointerup: swipe.handlers.pointerup,
      })
  },
})

const frame = () => new Promise((r) => requestAnimationFrame(r))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** a page lying over a tab page (the map or the locations list), as in the app's routes */
async function open(parent: '/map' | '/locations' = '/locations') {
  const Tab = { template: '<div><RouterView /></div>' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: { template: '<RouterView />' }, // the tab layout
        children: [
          { path: 'locations', component: Tab, children: [{ path: '/places/:id', component: Page }] },
          { path: 'map', component: Tab, children: [{ path: 'places/:id', component: Page }] },
        ],
      },
    ],
  })
  await router.push(parent === '/map' ? '/map/places/zav-bay' : '/places/zav-bay')
  const w = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  const start = router.currentRoute.value.path
  const main = w.find('main').element as HTMLElement
  const at = async (type: string, x: number, y = 300, t = 0) => {
    vi.spyOn(performance, 'now').mockReturnValue(t)
    await w.find('main').trigger(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
  }
  return { router, main, at, start }
}

afterEach(() => vi.restoreAllMocks())

describe('useSwipeBack', () => {
  it('the page follows the finger from where the swipe began, slides out, then the list opens with no animation', async () => {
    const { router, main, at } = await open()
    await at('pointerdown', 20)
    await at('pointermove', 60, 302, 100)
    await frame()
    expect(main.style.transform).toBe('translateX(30px)') // 40px moved − the 10px it took to become a swipe
    await at('pointermove', 160, 305, 400)
    await at('pointerup', 160, 305, 500)
    expect(main.style.transform).toBe('translateX(100%)')
    expect(router.currentRoute.value.path).toBe('/places/zav-bay') // not before the page has left
    await wait(260)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/locations')
    // the tab layout asks once: no animation for the list (the page already left), then back to normal
    expect(transitionFor(router.currentRoute.value)).toBe('none')
    expect(transitionFor(router.currentRoute.value)).toBe('fade')
  })

  it('a short slow drag slides the page back; a vertical move is a scroll, not a swipe', async () => {
    const { router, main, at } = await open()
    await at('pointerdown', 20)
    await at('pointermove', 70, 300, 300)
    await at('pointerup', 70, 300, 600)
    expect(main.style.transform).toBe('')
    await wait(260)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-bay')

    await at('pointerdown', 20, 300)
    await at('pointermove', 30, 360, 100)
    await at('pointermove', 200, 380, 200)
    await at('pointerup', 200, 380, 300)
    await wait(260)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-bay')
  })

  it('a quick flick is enough', async () => {
    const { router, at } = await open()
    await at('pointerdown', 20, 300, 0)
    await at('pointermove', 70, 300, 40)
    await at('pointerup', 70, 300, 60)
    await wait(260)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/locations')
  })

  it('a page over the map goes back to the map, which it lay over', async () => {
    const { router, at, start } = await open('/map')
    expect(start).toBe('/map/places/zav-bay')
    await at('pointerdown', 20, 300, 0)
    await at('pointermove', 200, 300, 100)
    await at('pointerup', 200, 300, 200)
    await wait(260)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/map')
  })
})
