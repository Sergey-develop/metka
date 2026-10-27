import type { CapacitorConfig } from '@capacitor/cli'

/**
 * CAP_SERVER_URL (set at `cap sync` time, e.g. in the iOS build workflow): the app shows the deployed
 * site (GitHub Pages, https://sergey-develop.github.io/metka/) instead of the bundled `dist`. The Yandex Maps key is restricted by Referer, which a
 * bundled app (capacitor://localhost) does not satisfy; the site's own domain does. Native plugins
 * (geolocation, camera, app lifecycle) keep working through the Capacitor bridge. Unset → bundle.
 */
const serverUrl = checkedServerUrl(process.env.CAP_SERVER_URL)

/**
 * A wrong address makes the iOS app open nothing at all (a black screen), with no error anywhere: the
 * build stops instead. Needs https:// and a host; a missing trailing slash is added (GitHub Pages serves
 * the app under /metka/).
 */
function checkedServerUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`CAP_SERVER_URL is not a URL: "${value}" (expected e.g. https://sergey-develop.github.io/metka/)`)
  }
  if (url.protocol !== 'https:' || !url.hostname || /[*\s]/.test(value)) {
    throw new Error(`CAP_SERVER_URL must be a plain https:// address, got "${value}"`)
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

const config: CapacitorConfig = {
  appId: 'app.metka.game',
  appName: 'Метка',
  webDir: 'dist',
  // errorPath: a page of the bundle shown when the site does not open (no network…) instead of a blank screen
  ...(serverUrl ? { server: { url: serverUrl, cleartext: false, errorPath: 'native-error.html' } } : {}),
  android: {
    // ship https-only; cleartext stays disabled
    allowMixedContent: false,
    // background exploration: without it Android stops location updates after 5 minutes in the background
    // (@capacitor-community/background-geolocation README, issue #89)
    useLegacyBridge: true,
  },
  ios: {
    contentInset: 'never',
    // the web view's colour before the page paints: light, as the app, not black
    backgroundColor: '#f5f4f2',
  },
}

export default config
