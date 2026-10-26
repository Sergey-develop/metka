<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, EMAIL_RE, MIN_PASSWORD } from './messages'
import OAuthButtons from './OAuthButtons.vue'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const pending = ref(false)
const error = ref<string | null>(null)

const canSubmit = computed(() => EMAIL_RE.test(email.value.trim()) && password.value.length >= MIN_PASSWORD)

async function submit(): Promise<void> {
  if (!canSubmit.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    const signedIn = await auth.signUp(email.value.trim(), password.value)
    // confirmation disabled: straight to the game profile step (router guard)
    if (signedIn) await router.replace('/map')
    else await router.replace({ name: 'confirm', query: { email: email.value.trim() } })
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Регистрация</h1>
    <p class="form__lead">Аккаунт хранит открытые здания и прогресс — на любом устройстве.</p>
    <div class="field">
      <label for="email">Почта</label>
      <input id="email" v-model="email" type="email" autocomplete="email" inputmode="email" required />
    </div>
    <div class="field">
      <label for="password">Пароль</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password" :minlength="MIN_PASSWORD" required />
      <p class="form__hint">Не меньше {{ MIN_PASSWORD }} символов.</p>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <AppButton type="submit" block :loading="pending" :disabled="!canSubmit">Создать аккаунт</AppButton>
    <OAuthButtons @error="error = $event" />
    <div class="form__links">
      <RouterLink :to="{ name: 'login-email' }">Войти</RouterLink>
      <span>Уже есть аккаунт?</span>
    </div>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
