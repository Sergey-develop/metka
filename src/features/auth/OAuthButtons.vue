<script setup lang="ts">
import { services } from '@/app/providers/services'
import type { OAuthProvider } from '@/app/config'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText } from './messages'

const emit = defineEmits<{ error: [message: string | null] }>()
const auth = useAuthStore()
const providers = services().config.oauthProviders
const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: 'Google', apple: 'Apple', github: 'GitHub' }

async function oauth(provider: OAuthProvider): Promise<void> {
  emit('error', null)
  try {
    await auth.signInWithOAuth(provider)
  } catch (e) {
    emit('error', authErrorText(e))
  }
}
</script>

<template>
  <template v-if="providers.length">
    <p class="oauth__divider muted">или</p>
    <AppButton v-for="p in providers" :key="p" variant="secondary" block @click="oauth(p)">
      Продолжить с {{ PROVIDER_LABEL[p] }}
    </AppButton>
  </template>
</template>

<style scoped lang="scss">
.oauth__divider {
  text-align: center;
  font-size: 13px;
}
</style>
