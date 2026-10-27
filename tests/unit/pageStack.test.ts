import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parentPath, stackedName } from '@/app/pageStack'

const stub = { template: '<div/>' }
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      component: stub, // the tab layout
      children: [
        { path: 'map', name: 'map', component: stub, children: [{ path: 'routes/:slug', name: 'map-route', component: stub }] },
        { path: 'tasks', name: 'tasks', component: stub },
        { path: 'routes/:slug', name: 'route', component: stub },
      ],
    },
  ],
})
const at = async (path: string) => {
  await router.push(path)
  return router.currentRoute.value
}

describe('pageStack', () => {
  it('from the map (its tasks sheet) a quest opens over the map; from a page of its own, as a page', async () => {
    expect(stackedName(await at('/map'), 'route')).toBe('map-route')
    expect(stackedName(await at('/map/routes/zav-forest'), 'route')).toBe('map-route')
    expect(stackedName(await at('/tasks'), 'route')).toBe('route')
    // the collection from the tasks sheet stays over the map; from the tasks page it is the profile's
    expect(stackedName(await at('/map'), 'collection')).toBe('map-collection')
    expect(stackedName(await at('/tasks'), 'collection')).toBe('collection')
  })

  it('a page over the map goes back to the map; a page of its own has no parent', async () => {
    expect(parentPath(await at('/map/routes/zav-forest'))).toBe('/map')
    expect(parentPath(await at('/routes/zav-forest'))).toBeNull()
  })
})
