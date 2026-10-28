import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RouteCard from '@/features/map/RouteCard.vue'
import { BUILDING } from './helpers'

const PLACE = { ...BUILDING, name: 'Завидово', address: 'Тверская область, Конаковский муниципальный округ', rarity: 'rare' as const }
const ROUTE = { path: [], distanceM: 1200, durationS: 17 * 60 }

function card(over: Partial<InstanceType<typeof RouteCard>['$props']> = {}) {
  return mount(RouteCard, {
    props: { place: PLACE, photo: 'https://img.test/z.webp', route: ROUTE, state: 'ready', errorCode: null, noLocation: false, ...over },
  })
}

describe('RouteCard (mockup «карта с меткой»)', () => {
  it('shows photo, tag, name (no address) and the walking time; a tap opens the place', async () => {
    const w = card()
    expect(w.find('img').attributes('src')).toBe('https://img.test/z.webp')
    expect(w.find('.route__tag').text()).toBe('Редкое')
    expect(w.find('.route__name').text()).toBe('Завидово')
    expect(w.text()).not.toContain(PLACE.address)
    expect(w.find('.route__meta').text()).toBe('15–20 мин')
    await w.trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })

  it('on an error offers a retry that does not open the place', async () => {
    const w = card({ route: null, state: 'error', errorCode: 'network' })
    expect(w.find('.route__meta').text()).toContain('Нет связи с сервером маршрутов')
    await w.find('.route__retry').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
    expect(w.emitted('open')).toBeUndefined()
  })

  it('says when the player has arrived or location is off', () => {
    expect(card({ route: null, state: 'arrived' }).find('.route__meta').text()).toBe('Вы на месте')
    expect(card({ route: null, state: 'waiting_position', noLocation: true }).find('.route__meta').text()).toBe('Включите геолокацию')
  })
})
