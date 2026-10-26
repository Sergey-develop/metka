import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import PhoneAuthView from '@/features/auth/PhoneAuthView.vue'
import { formatRuPhone, isCompleteRuPhone, ruPhoneDigits, ruPhoneE164 } from '@/features/auth/phone'
import { SMS_CODE_LENGTH } from '@/features/auth/messages'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readConfig } from '@/app/config'
import { AppAuthError, AuthService, mapAuthError } from '@/services/auth/authService'
import { CONFIG, installFakeServices } from './helpers'

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

describe('phone sign-in with a fixed test code', () => {
  type Result = { data: { session: object | null }; error: (Error & { code?: string }) | null }
  function fakeClient(signIn: Result['error'], signUp: Result) {
    const auth = {
      signInWithPassword: vi.fn(async (_c: { phone: string; password: string }) => ({ data: { session: signIn ? null : {} }, error: signIn })),
      signUp: vi.fn(async (_c: { phone: string; password: string }) => signUp),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
    }
    return { auth }
  }
  const service = (client: ReturnType<typeof fakeClient>) =>
    new AuthService(client as unknown as SupabaseClient, { ...CONFIG, phoneFixedCode: '1111' })
  const wrong = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' })

  it('sends no SMS and accepts only the fixed code', async () => {
    const client = fakeClient(null, { data: { session: {} }, error: null })
    await service(client).requestPhoneCode('+79991234567')
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled()
    await expect(service(client).verifyPhoneCode('+79991234567', '2222')).rejects.toMatchObject({ code: 'invalid_code' })
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signs in a known number', async () => {
    const client = fakeClient(null, { data: { session: {} }, error: null })
    await service(client).verifyPhoneCode('+79991234567', '1111')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ phone: '+79991234567', password: 'metka-phone-1111' })
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })

  it('registers an unknown number', async () => {
    const client = fakeClient(wrong, { data: { session: {} }, error: null })
    await service(client).verifyPhoneCode('+79991234567', '1111')
    expect(client.auth.signUp).toHaveBeenCalledWith({ phone: '+79991234567', password: 'metka-phone-1111' })
  })

  it('explains a number taken by SMS sign-in and a project that still confirms phones', async () => {
    const taken = fakeClient(wrong, { data: { session: null }, error: Object.assign(new Error('User already registered'), { code: 'phone_exists' }) })
    await expect(service(taken).verifyPhoneCode('+79991234567', '1111')).rejects.toMatchObject({ code: 'phone_taken' })
    const confirming = fakeClient(wrong, { data: { session: null }, error: null })
    await expect(service(confirming).verifyPhoneCode('+79991234567', '1111')).rejects.toMatchObject({ code: 'phone_unavailable' })
  })

  it('is on by default with 1111 and can be turned off', () => {
    const base = { DEV: false, VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_ANON_KEY: 'k', VITE_YANDEX_MAPS_API_KEY: '00000000-0000-4000-8000-000000000000' }
    const on = readConfig(base)
    const off = readConfig({ ...base, VITE_PHONE_FIXED_CODE: 'off' })
    const custom = readConfig({ ...base, VITE_PHONE_FIXED_CODE: '2024' })
    expect(on.ok && on.config.phoneFixedCode).toBe('1111')
    expect(off.ok && off.config.phoneFixedCode).toBeNull()
    expect(custom.ok && custom.config.phoneFixedCode).toBe('2024')
  })

  it('the code screen has 4 cells, no hint and no resend', async () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    installFakeServices()
    const verify = vi.fn(async (_p: string, _c: string) => undefined)
    Object.assign(services(), {
      config: { ...services().config, phoneFixedCode: '1111' },
      auth: { requestPhoneCode: vi.fn(async () => undefined), verifyPhoneCode: verify, signInWithOAuth: vi.fn() },
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/auth/login', name: 'login', component: PhoneAuthView, props: { mode: 'login' } },
        { path: '/auth/register', name: 'register', component: { template: '<div />' } },
        { path: '/auth/email', name: 'login-email', component: { template: '<div />' } },
        { path: '/map', name: 'map', component: { template: '<div />' } },
      ],
    })
    await router.push('/auth/login')
    const w = mount(PhoneAuthView, { props: { mode: 'login' }, global: { plugins: [router] }, attachTo: document.body })
    await w.find('#phone').setValue('9991234567')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.findAll('.code__cell')).toHaveLength(4)
    expect(w.text()).not.toContain('1111')
    expect(w.find('.hero__resend').exists()).toBe(false)
    await w.find('.code__input').setValue('1111')
    await flushPromises()
    expect(verify).toHaveBeenCalledWith('+79991234567', '1111')
    expect(router.currentRoute.value.path).toBe('/map')
    w.unmount()
    vi.useRealTimers()
  })
})
