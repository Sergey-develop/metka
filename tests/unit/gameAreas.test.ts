import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MoscowMapCard from '@/features/profile/MoscowMapCard.vue'
import { gameAreaAt } from '@/utils/gameAreas'

describe('gameAreaAt', () => {
  it('finds Moscow, Zavidovo or nothing', () => {
    expect(gameAreaAt({ lat: 55.7558, lng: 37.6173 })).toBe('moscow')
    expect(gameAreaAt({ lat: 56.595, lng: 36.52 })).toBe('zavidovo')
    expect(gameAreaAt({ lat: 59.93, lng: 30.31 })).toBeNull()
  })
})

describe('MoscowMapCard', () => {
  it('names the area the player is in and takes its share from areaProgress', () => {
    const w = mount(MoscowMapCard, { props: { districts: [], area: 'zavidovo', areaProgress: { total: 8, discovered: 2 } } })
    expect(w.find('.mcard__lead').text()).toBe('Ты открыл')
    expect(w.find('.mcard__value').text()).toBe('25% Завидово')
  })

  it('stays on Moscow by default', () => {
    const w = mount(MoscowMapCard, { props: { districts: [] } })
    expect(w.find('.mcard__value').text()).toBe('0% Москвы')
  })
})
