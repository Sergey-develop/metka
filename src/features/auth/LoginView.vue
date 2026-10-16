<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { AppAuthError } from '@/services/auth/authService'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, EMAIL_RE } from './messages'
import OAuthButtons from './OAuthButtons.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const pending = ref(false)
const error = ref<string | null>(null)
const unconfirmed = ref(false)

const canSubmit = computed(() => EMAIL_RE.test(email.value.trim()) && password.value.length > 0)

async function submit(): Promise<void> {
  if (!canSubmit.value || pending.value) return
  pending.value = true
  error.value = null
  unconfirmed.value = false
  try {
    await auth.signIn(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/map'
    await router.replace(redirect)
  } catch (e) {
    error.value = authErrorText(e)
    unconfirmed.value = e instanceof AppAuthError && e.code === 'email_not_confirmed'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Вход</h1>
    <p v-if="auth.sessionExpired" class="notice notice--warning">Сессия истекла. Войдите снова.</p>
    <p v-if="route.query.error === 'callback'" class="notice notice--error">Не удалось завершить вход по ссылке.</p>
    <div class="field">
      <label for="email">Почта</label>
      <input id="email" v-model="email" type="email" autocomplete="email" inputmode="email" required />
    </div>
    <div class="field">
      <label for="password">Пароль</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" required />
    </div>
    <p v-if="error" class="notice notice--error" role="alert">
      {{ error }}
      <RouterLink v-if="unconfirmed" :to="{ name: 'confirm', query: { email: email.trim() } }">Ввести код</RouterLink>
    </p>
    <AppButton type="submit" block :loading="pending" :disabled="!canSubmit">Войти</AppButton>
    <OAuthButtons @error="error = $event" />
    <div class="form__links">
      <RouterLink to="/auth/reset">Забыли пароль?</RouterLink>
      <RouterLink to="/auth/register">Создать аккаунт</RouterLink>
    </div>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
