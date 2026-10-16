<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useAuthStore } from '@/stores/auth'

// Web OAuth / email-confirmation landing: supabase-js exchanges the PKCE code
// from the URL itself (detectSessionInUrl); we just wait for the session.
const auth = useAuthStore()
const router = useRouter()

onMounted(() => {
  const timer = setTimeout(() => {
    if (auth.status !== 'signed_in') void router.replace({ name: 'login', query: { error: 'callback' } })
  }, 10_000)
  watch(
    () => auth.status,
    (status) => {
      if (status === 'signed_in') {
        clearTimeout(timer)
        void router.replace(auth.recoveryMode ? '/auth/update-password' : '/map')
      }
    },
    { immediate: true },
  )
})
</script>

<template>
  <StateBlock kind="loading" title="Завершаем вход…" />
</template>
