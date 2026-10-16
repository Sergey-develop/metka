import { describe, expect, it, vi } from 'vitest'
import { readConfig } from '@/app/config'
import { ApiError, toApiError, withRetry } from '@/services/api/errors'
import { GameApi, parseScanDecision } from '@/services/api/gameApi'
import { mapAuthError } from '@/services/auth/authService'
import { mapCameraError } from '@/services/camera/capacitorCamera'
import { mapGeolocationError } from '@/services/geolocation/capacitorGeolocation'
import { levelForXp, levelProgress, xpForLevel } from '@/features/progression/levels'
import { allowedScanDistance, distanceMeters, formatDistance } from '@/utils/geo'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('API errors', () => {
  it('maps PostgREST, domain and network errors', () => {
    expect(toApiError({ message: 'quest_not_completed', code: 'P0001' }).code).toBe('quest_not_completed')
    expect(toApiError({ message: 'not_authenticated', code: '42501' }).code).toBe('unauthorized')
    expect(toApiError({ message: 'permission denied for table x', code: '42501' }).code).toBe('forbidden')
    expect(toApiError({ message: 'dup', code: '23505' }).code).toBe('conflict')
    expect(toApiError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toApiError({ message: 'boom', code: 'XX000' }).code).toBe('server')
  })

  it('retries only retryable errors', async () => {
    const sleep = vi.fn(async () => undefined)
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue('ok')
    await expect(withRetry(flaky, { sleep })).resolves.toBe('ok')
    expect(flaky).toHaveBeenCalledTimes(2)

    const forbidden = vi.fn().mockRejectedValue({ message: 'x', code: '42501' })
    await expect(withRetry(forbidden, { sleep })).rejects.toMatchObject({ code: 'forbidden' })
    expect(forbidden).toHaveBeenCalledTimes(1)

    const down = vi.fn().mockRejectedValue({ message: 'x', code: 'XX000' })
    await expect(withRetry(down, { sleep, retries: 2 })).rejects.toBeInstanceOf(ApiError)
    expect(down).toHaveBeenCalledTimes(3)
  })
})

describe('GameApi parsing', () => {
  it('parses a scan decision and rejects malformed payloads', () => {
    const d = parseScanDecision({
      scanId: 's',
      status: 'accepted',
      reason: null,
      buildingId: 'b',
      distanceM: 12.5,
      reward: { xp: 1, coins: 2, influence: 3 },
      completedQuests: [{ questId: 'q', slug: 'first-mark', title: 'Первая метка' }],
      profile: { level: 2, xp: 120, coins: 30, buildingsDiscovered: 1 },
      duplicate: false,
    })
    expect(d.reward).toEqual({ xp: 1, coins: 2, influence: 3 })
    expect(() => parseScanDecision({ scanId: 's', status: 'granted' })).toThrow(ApiError)
    expect(() => parseScanDecision({ scanId: 's', status: 'rejected', reason: 'because' })).toThrow(ApiError)
  })

  it('sends the embedding as a plain array and maps RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'not_authenticated', code: '42501' } })
    const api = new GameApi({ rpc } as unknown as SupabaseClient)
    await expect(
      api.submitScan({
        clientRequestId: 'r',
        buildingId: 'b',
        lat: 1,
        lng: 2,
        accuracyM: 5,
        modelVersion: 'm',
        embedding: new Float32Array([0.5, 0.5]),
        imageSha256: null,
        quality: null,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(rpc).toHaveBeenCalledWith('submit_building_scan', expect.objectContaining({ p_embedding: [0.5, 0.5] }))
  })

  describe('clan avatar', () => {
    const CLAN = '11111111-1111-4111-8111-111111111111'
    function fakeClient(rpcResult: { data: unknown; error: unknown }) {
      const bucket = {
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
      const client = { rpc: vi.fn().mockResolvedValue(rpcResult), storage: { from: vi.fn(() => bucket) } }
      return { api: new GameApi(client as unknown as SupabaseClient), client, bucket }
    }
    const image = new Blob(['x'], { type: 'image/webp' })

    it('uploads into the clan folder under a fresh name and deletes the previous file', async () => {
      const { api, client, bucket } = fakeClient({ data: `${CLAN}/old.webp`, error: null })
      await api.setClanAvatar(CLAN, image)
      const path = bucket.upload.mock.calls[0]?.[0] as string
      expect(path).toMatch(new RegExp(`^${CLAN}/[0-9a-f-]{36}\\.webp$`))
      expect(bucket.upload).toHaveBeenCalledWith(path, image, expect.objectContaining({ upsert: false }))
      expect(client.rpc).toHaveBeenCalledWith('set_clan_avatar', { p_path: path })
      expect(bucket.remove).toHaveBeenCalledWith([`${CLAN}/old.webp`])
    })

    it('removes the uploaded file when the server rejects it', async () => {
      const { api, bucket } = fakeClient({ data: null, error: { message: 'not_clan_owner', code: 'P0001' } })
      await expect(api.setClanAvatar(CLAN, image)).rejects.toMatchObject({ code: 'not_clan_owner' })
      const path = bucket.upload.mock.calls[0]?.[0] as string
      expect(bucket.remove).toHaveBeenCalledWith([path])
    })
  })
})

describe('platform adapters', () => {
  it('maps Capacitor camera errors', () => {
    expect(mapCameraError({ code: 'OS-PLUG-CAMR-0003', message: 'x' }).code).toBe('permission_denied')
    expect(mapCameraError({ code: 'OS-PLUG-CAMR-0006', message: 'x' }).code).toBe('cancelled')
    expect(mapCameraError({ code: 'OS-PLUG-CAMR-0007', message: 'x' }).code).toBe('unavailable')
    expect(mapCameraError(new Error('User cancelled photos app')).code).toBe('cancelled')
    expect(mapCameraError(new Error('weird')).code).toBe('failed')
  })

  it('maps native and browser geolocation errors', () => {
    expect(mapGeolocationError({ code: 'OS-PLUG-GLOC-0003', message: '' }).code).toBe('permission_denied')
    expect(mapGeolocationError({ code: 'OS-PLUG-GLOC-0007', message: '' }).code).toBe('disabled')
    expect(mapGeolocationError({ code: 'OS-PLUG-GLOC-0010', message: '' }).code).toBe('timeout')
    expect(mapGeolocationError({ code: 1, message: 'User denied Geolocation' }).code).toBe('permission_denied')
    expect(mapGeolocationError({ code: 2, message: 'Position unavailable' }).code).toBe('unavailable')
  })

  it('maps Supabase Auth errors', () => {
    expect(mapAuthError(new Error('Invalid login credentials')).code).toBe('invalid_credentials')
    expect(mapAuthError(Object.assign(new Error('x'), { code: 'email_not_confirmed' })).code).toBe('email_not_confirmed')
    expect(mapAuthError(new Error('Invalid Refresh Token: Refresh Token Not Found')).code).toBe('session_expired')
  })
})

describe('config', () => {
  it('requires public Supabase settings and never enables mocks in production', () => {
    expect(readConfig({ DEV: false })).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] })
    const prod = readConfig({ DEV: false, VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_ANON_KEY: 'k', VITE_USE_MOCKS: 'true' })
    expect(prod.ok && prod.config.useMocks).toBe(false)
    const dev = readConfig({
      DEV: true,
      VITE_SUPABASE_URL: 'https://a.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
      VITE_USE_MOCKS: 'true',
      VITE_AUTH_OAUTH_PROVIDERS: 'google, nope ,apple',
    })
    expect(dev.ok && dev.config.useMocks).toBe(true)
    expect(dev.ok && dev.config.oauthProviders).toEqual(['google', 'apple'])
  })
})

describe('progression and geo', () => {
  it('computes levels and progress', () => {
    expect([0, 99, 100, 299, 300].map(levelForXp)).toEqual([1, 1, 2, 2, 3])
    expect(xpForLevel(4)).toBe(600)
    expect(levelProgress(200)).toMatchObject({ level: 2, xpIntoLevel: 100, xpForNextLevel: 200, ratio: 0.5 })
  })

  it('computes distances like the server allowance', () => {
    expect(distanceMeters({ lat: 55.75, lng: 37.6 }, { lat: 55.75, lng: 37.601 })).toBeCloseTo(62.8, 0)
    expect(allowedScanDistance(100, 80)).toBe(130)
    expect(formatDistance(1530)).toBe('1,5 км')
  })
})
