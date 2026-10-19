import '@fontsource-variable/inter/wght.css'
import '@fontsource/doto/900.css'
import './styles/main.scss'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { readConfig } from './app/config'
import ConfigErrorView from './app/ConfigErrorView.vue'
import { createServices, setServices } from './app/providers/services'
import { router } from './app/router'
import { useAuthStore } from './stores/auth'
import { useExplorationStore } from './stores/exploration'
import { useMapStore } from './stores/map'
import { useOutlinesStore } from './stores/outlines'
import { useScanStore } from './stores/scan'

async function bootstrap(): Promise<void> {
  const result = readConfig(import.meta.env)
  if (!result.ok) {
    createApp(ConfigErrorView, { missing: result.missing }).mount('#app')
    return
  }

  const services = await createServices(result.config)
  setServices(services)

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)

  // mobile lifecycle: refresh tokens, pause GPS, re-check permissions on resume
  services.lifecycle.onActiveChange((active) => {
    services.auth.setForeground(active)
    const map = useMapStore(pinia)
    if (active) {
      map.invalidate()
      useOutlinesStore(pinia).invalidate()
      // exploration runs in the foreground only: resume if the player left it on
      void useExplorationStore(pinia).resume()
      useScanStore(pinia).onResume()
      if (useAuthStore(pinia).status === 'signed_in' && router.currentRoute.value.name === 'map') void map.startTracking()
    } else {
      map.stopTracking()
      void useExplorationStore(pinia).pause()
    }
  })
  services.lifecycle.onDeepLink((url) => {
    services.auth
      .handleDeepLink(url)
      .then((handled) => {
        if (handled) void router.replace(useAuthStore(pinia).recoveryMode ? '/auth/update-password' : '/map')
      })
      .catch(() => void router.replace({ name: 'login', query: { error: 'callback' } }))
  })

  await router.isReady()
  app.mount('#app')
}

void bootstrap()
