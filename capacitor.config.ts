import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.metka.game',
  appName: 'Метка',
  webDir: 'dist',
  android: {
    // ship https-only; cleartext stays disabled
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
