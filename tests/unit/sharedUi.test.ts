import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CategoryChips from '@/components/ui/CategoryChips.vue'
import LevelProgress from '@/components/ui/LevelProgress.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import WalletStreak from '@/components/ui/WalletStreak.vue'
import { levelProgress } from '@/features/progression/levels'
import { daysText, plural } from '@/utils/plural'
import { PLACE_CHIPS } from '@/features/routes/routes'

describe('PlayerAvatar', () => {
  it('photo first, then the preset figure, then the initials', () => {
    const photo = mount(PlayerAvatar, { props: { url: 'https://cdn.test/a.webp', figure: 'runner', name: 'Анна', size: 40 } })
    expect(photo.find('img').attributes('src')).toBe('https://cdn.test/a.webp')
    const figure = mount(PlayerAvatar, { props: { url: null, figure: 'runner', name: 'Анна', size: 40 } })
    expect(figure.find('.figure-avatar').exists()).toBe(true)
    expect(mount(PlayerAvatar, { props: { url: null, figure: null, name: 'анна', size: 40 } }).text()).toBe('А')
    expect(mount(PlayerAvatar, { props: { url: null, figure: null, name: 'Иван Петров', size: 40, letters: 2 } }).text()).toBe('ИП')
    expect(mount(PlayerAvatar, { props: { url: null, figure: null, name: 'миша', size: 40, letters: 2 } }).text()).toBe('МИ')
  })
})

describe('LevelProgress', () => {
  it('level, bar and XP into the level', () => {
    const p = levelProgress(926)
    const w = mount(LevelProgress, { props: { level: 4, xp: 926 } })
    expect(w.find('.lvl__title').text()).toBe('4 уровень')
    expect(w.find('.lvl__xp').text()).toBe(`${p.xpIntoLevel}/${p.xpForNextLevel}`)
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe(String(p.xpIntoLevel))
  })
})

describe('WalletStreak', () => {
  it('coins and the streak; no coins for someone else; a dash while unknown', () => {
    const w = mount(WalletStreak, { props: { coins: 1245, streak: 3 } })
    expect(w.find('.wallet__coins').text().replace(/\s/g, '')).toBe('1245')
    expect(w.find('.wallet__streak').text()).toBe('3 дня')
    expect(mount(WalletStreak, { props: { coins: null, streak: 7 } }).find('.wallet__coins').exists()).toBe(false)
    expect(mount(WalletStreak, { props: { coins: 0, streak: null } }).find('.wallet__streak').text()).toBe('— дней')
  })
})

describe('CategoryChips', () => {
  it('the place tags of Теги.png: colour and icon per tag; a tap chooses, a second tap clears', async () => {
    const w = mount(CategoryChips, { props: { items: PLACE_CHIPS, modelValue: null } })
    const chips = w.findAll('button')
    expect(chips.map((c) => c.text())).toEqual(['Развлечения', 'Природа', 'История', 'Спорт', 'Рестораны', 'Отели'])
    expect(chips.map((c) => c.classes().find((k) => k.startsWith('cat--')))).toEqual(['cat--fun', 'cat--nature', 'cat--history', 'cat--sport', 'cat--food', 'cat--hotel'])
    expect(chips.every((c) => c.find('svg').exists())).toBe(true)
    await chips[4]!.trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual(['food'])
    await w.setProps({ modelValue: 'food' })
    await w.findAll('button')[4]!.trigger('click')
    expect(w.emitted('update:modelValue')![1]).toEqual([null])
  })
})

describe('plural', () => {
  it('Russian forms', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, ['день', 'дня', 'дней']))).toEqual([
      'день', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'дней',
    ])
    expect(daysText(21)).toBe('21 день')
    expect(daysText(undefined)).toBe('— дней')
  })
})
