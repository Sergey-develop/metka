import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import PhoneAuthView from '@/features/auth/PhoneAuthView.vue'
import { formatRuPhone, isCompleteRuPhone, ruPhoneDigits, ruPhoneE164 } from '@/features/auth/phone'
import { SMS_CODE_LENGTH } from '@/features/auth/messages'
import { AppAuthError, mapAuthError } from '@/services/auth/authService'
import { installFakeServices } from './helpers'

describe('Russian phone input', () => {
  it('takes national digits from typed or pasted text', () => {
    expect(ruPhoneDigits('+7 (999) 123-45-67')).toBe('9991234567')
    expect(ruPhoneDigits('8 999 123 45 67')).toBe('9991234567')
    expect(ruPhoneDigits('999123456789')).toBe('9991234567')
    expect(ruPhoneDigits('99')).toBe('99')
  })

  it('formats as in the mockup and never ends on a separator', () => {
    expect(formatRuPhone('9991234567')).toBe('(999) 123-45-67')
    expect(formatRuPhone('999')).toBe('(999')
    expect(formatRuPhone('9991')).toBe('(999) 1')
    expect(formatRuPhone('9991234')).toBe('(999) 123-4')
    expect(formatRuPhone('')).toBe('')
  })

  it('sends only complete numbers in E.164', () => {
    expect(isCompleteRuPhone('999123456')).toBe(false)
    expect(isCompleteRuPhone('9991234567')).toBe(true)
    expect(ruPhoneE164('9991234567')).toBe('+79991234567')
  })
})

describe('phone auth errors', () => {
  it('maps Supabase SMS errors', () => {
    expect(mapAuthError(Object.assign(new Error('x'), { code: 'sms_send_failed' })).code).toBe('phone_unavailable')
    expect(mapAuthError(new Error('Unsupported phone provider')).code).toBe('phone_unavailable')
    expect(mapAuthError(Object.assign(new Error('x'), { code: 'over_sms_send_rate_limit' })).code).toBe('rate_limited')
    expect(mapAuthError(Object.assign(new Error('Token has expired or is invalid'), { code: 'otp_expired' })).code).toBe('invalid_code')
  })
})

describe('PhoneAuthView', () => {
  const auth = {
    requestPhoneCode: vi.fn(async (_phone: string) => undefined),
    verifyPhoneCode: vi.fn(async (_phone: string, _code: string) => undefined),
    signInWithOAuth: vi.fn(async () => undefined),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    installFakeServices()
    Object.assign(services(), { auth })
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  async function setup(query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/auth/login', name: 'login', component: PhoneAuthView, props: { mode: 'login' } },
        { path: '/auth/register', name: 'register', component: { template: '<div />' } },
        { path: '/auth/email', name: 'login-email', component: { template: '<div />' } },
        { path: '/map', name: 'map', component: { template: '<div />' } },
        { path: '/clan', name: 'clan', component: { template: '<div />' } },
      ],
    })
    await router.push({ name: 'login', query })
    const w = mount(PhoneAuthView, { props: { mode: 'login' }, global: { plugins: [router] }, attachTo: document.body })
    return { w, router }
  }

  it('requests a code for the formatted number, then signs in with it', async () => {
    const { w, router } = await setup({ redirect: '/clan' })
    const submit = () => w.find('button[type="submit"]')
    expect(submit().attributes('disabled')).toBeDefined()

    await w.find('#phone').setValue('8 (999) 123-45-67')
    expect((w.find('#phone').element as HTMLInputElement).value).toBe('(999) 123-45-67')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(auth.requestPhoneCode).toHaveBeenCalledWith('+79991234567')
    expect(w.text()).toContain('+7 (999) 123-45-67')
    expect(w.text()).toContain('01:00')

    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(w.text()).toContain('00:59')
    expect(w.findAll('.code__cell')).toHaveLength(SMS_CODE_LENGTH)

    // complete code submits by itself (SMS autofill)
    await w.find('.code__input').setValue('123456')
    await flushPromises()
    expect(auth.verifyPhoneCode).toHaveBeenCalledWith('+79991234567', '123456')
    expect(router.currentRoute.value.fullPath).toBe('/clan')
    w.unmount()
  })

  it('shows the error and clears a wrong code', async () => {
    auth.verifyPhoneCode.mockRejectedValueOnce(new AppAuthError('invalid_code'))
    const { w, router } = await setup()
    await w.find('#phone').setValue('9991234567')
    await w.find('form').trigger('submit')
    await flushPromises()
    await w.find('.code__input').setValue('000000')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('Код неверный')
    expect((w.find('.code__input').element as HTMLInputElement).value).toBe('')
    expect(router.currentRoute.value.name).toBe('login')
    w.unmount()
  })

  it('offers resend only after the cooldown and goes back to the number', async () => {
    const { w } = await setup()
    await w.find('#phone').setValue('9991234567')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('.hero__resend button').exists()).toBe(false)
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    await w.find('.hero__resend button').trigger('click')
    await flushPromises()
    expect(auth.requestPhoneCode).toHaveBeenCalledTimes(2)

    await w.find('.hero__back').trigger('click')
    expect((w.find('#phone').element as HTMLInputElement).value).toBe('(999) 123-45-67')
    w.unmount()
  })

  it('Yandex and VK are marked as coming soon and start nothing', async () => {
    const { w } = await setup()
    const yandex = w.find('[aria-label="Яндекс — скоро"]')
    expect(w.find('[aria-label="VK — скоро"]').exists()).toBe(true)
    await yandex.trigger('click')
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
    expect(w.text()).toContain('Вход через Яндекс появится позже.')
    w.unmount()
  })
})
