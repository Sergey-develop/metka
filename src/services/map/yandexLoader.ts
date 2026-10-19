import type * as Ymaps from '@yandex/ymaps3-types'
import { MapLoadError } from './types'

export type YmapsApi = typeof Ymaps

const SCRIPT_URL = 'https://api-maps.yandex.ru/v3/'
const TIMEOUT_MS = 20_000

let pending: Promise<YmapsApi> | null = null

function globalApi(): YmapsApi | undefined {
  return (globalThis as { ymaps3?: YmapsApi }).ymaps3
}

/**
 * Loads Yandex Maps JS API 3.0 once per app run. The key is public; Yandex checks the page's
 * HTTP Referer against the restriction set in the developer console (localhost for dev/Android).
 * A rejected key makes the script fail to load (HTTP 403) → MapLoadError('script_failed').
 */
export function loadYandexMaps(apiKey: string, doc: Document = document): Promise<YmapsApi> {
  const ready = globalApi()
  if (ready) return ready.ready.then(() => ready)
  if (pending) return pending

  pending = new Promise<YmapsApi>((resolve, reject) => {
    const script = doc.createElement('script')
    const fail = (reason: string, cause?: unknown) => {
      clearTimeout(timer)
      script.remove()
      pending = null // allow a retry (e.g. after the network comes back)
      reject(new MapLoadError(reason, { cause }))
    }
    const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS)
    script.src = `${SCRIPT_URL}?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
    script.async = true
    script.onerror = () => fail('script_failed')
    script.onload = () => {
      const api = globalApi()
      if (!api) return fail('api_missing')
      api.ready.then(
        () => {
          clearTimeout(timer)
          resolve(api)
        },
        (e: unknown) => fail('api_not_ready', e),
      )
    }
    doc.head.append(script)
  })
  return pending
}

/** test hook */
export function resetYandexLoader(): void {
  pending = null
}
