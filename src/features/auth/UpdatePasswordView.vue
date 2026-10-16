<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, MIN_PASSWORD } from './messages'

const auth = useAuthStore()
const router = useRouter()
const password = ref('')
const pending = ref(false)
const error = ref<string | null>(null)
const canSubmit = computed(() => password.value.length >= MIN_PASSWORD && auth.status === 'signed_in')

async function submit(): Promise<void> {
  if (!canSubmit.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await auth.updatePassword(password.value)
    await router.replace('/map')
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Новый пароль</h1>
    <p v-if="auth.status !== 'signed_in'" class="notice notice--warning">
      Ссылка недействительна или устарела. Запросите восстановление ещё раз.
    </p>
    <div class="field">
      <label for="password">Пароль</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password" :minlength="MIN_PASSWORD" />
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <AppButton type="submit" block :loading="pending" :disabled="!canSubmit">Сохранить</AppButton>
    <div class="form__links">
      <RouterLink to="/auth/reset">Запросить новую ссылку</RouterLink>
    </div>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
