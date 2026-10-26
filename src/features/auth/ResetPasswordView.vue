<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, EMAIL_RE } from './messages'

const auth = useAuthStore()
const email = ref('')
const pending = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)
const canSubmit = computed(() => EMAIL_RE.test(email.value.trim()))

async function submit(): Promise<void> {
  if (!canSubmit.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await auth.requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Восстановление доступа</h1>
    <p v-if="sent" class="notice notice--success">
      Если аккаунт с адресом {{ email }} существует, мы отправили на него ссылку для смены пароля.
    </p>
    <template v-else>
      <div class="field">
        <label for="email">Почта</label>
        <input id="email" v-model="email" type="email" autocomplete="email" inputmode="email" required />
      </div>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <AppButton type="submit" block :loading="pending" :disabled="!canSubmit">Отправить ссылку</AppButton>
    </template>
    <div class="form__links">
      <RouterLink :to="{ name: 'login-email' }">Ко входу</RouterLink>
    </div>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
