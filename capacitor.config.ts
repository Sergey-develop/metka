import type { CapacitorConfig } from '@capacitor/cli'

/**
 * CAP_SERVER_URL (set at `cap sync` time, e.g. in the iOS build workflow): the app shows the deployed
 * site (GitHub Pages, https://sergey-develop.github.io/metka/) instead of the bundled `dist`. The Yandex Maps key is restricted by Referer, which a
 * bundled app (capacitor://localhost) does not satisfy; the site's own domain does. Native plugins
 * (geolocation, camera, app lifecycle) keep working through the Capacitor bridge. Unset → bundle.
 */
const serverUrl = process.env.CAP_SERVER_URL?.trim() || undefined

const config: CapacitorConfig = {
  appId: 'app.metka.game',
  appName: 'Метка',
  webDir: 'dist',
  ...(serverUrl ? { server: { url: serverUrl, cleartext: false } } : {}),
  android: {
    // ship https-only; cleartext stays disabled
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
