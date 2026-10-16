<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, EMAIL_RE, OTP_RE, RESEND_COOLDOWN_S } from './messages'

// Registration step "confirmation": one-time code from the email, or the link in it
// (the link lands on /auth/callback and signs in on its own).
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = computed(() => (typeof route.query.email === 'string' ? route.query.email.trim() : ''))
const code = ref('')
const pending = ref(false)
const error = ref<string | null>(null)
const resent = ref(false)
const cooldown = ref(RESEND_COOLDOWN_S)
let timer: ReturnType<typeof setInterval> | undefined

const cleanCode = computed(() => code.value.replace(/\s/g, ''))
const canSubmit = computed(() => OTP_RE.test(cleanCode.value))

function startCooldown(): void {
  cooldown.value = RESEND_COOLDOWN_S
  clearInterval(timer)
  timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) clearInterval(timer)
  }, 1000)
}

onMounted(() => {
  if (!EMAIL_RE.test(email.value)) void router.replace({ name: 'register' })
  else startCooldown()
})
onBeforeUnmount(() => clearInterval(timer))

async function submit(): Promise<void> {
  if (!canSubmit.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await auth.verifyEmailCode(email.value, cleanCode.value)
    // signed in now; the router guard sends a new player to the game profile step
    await router.replace('/map')
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    pending.value = false
  }
}

async function resend(): Promise<void> {
  if (cooldown.value > 0) return
  error.value = null
  resent.value = false
  try {
    await auth.resendConfirmation(email.value)
    resent.value = true
    startCooldown()
  } catch (e) {
    error.value = authErrorText(e)
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Подтвердите почту</h1>
    <p class="form__lead">
      Мы отправили письмо на <strong>{{ email }}</strong>. Введите код из письма или просто откройте ссылку в нём.
    </p>
    <div class="field">
      <label for="code">Код из письма</label>
      <input
        id="code"
        v-model="code"
        class="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="12"
        placeholder="••••••"
        required
      />
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-else-if="resent" class="notice notice--info" role="status">Письмо отправлено ещё раз.</p>
    <AppButton type="submit" block :loading="pending" :disabled="!canSubmit">Подтвердить</AppButton>
    <AppButton variant="ghost" block :disabled="cooldown > 0" @click="resend">
      {{ cooldown > 0 ? `Отправить снова через ${cooldown} с` : 'Отправить письмо снова' }}
    </AppButton>
    <p class="form__hint">Письма нет? Проверьте «Спам» и правильность адреса.</p>
    <div class="form__links">
      <RouterLink to="/auth/register">Другая почта</RouterLink>
      <RouterLink to="/auth/login">Ко входу</RouterLink>
    </div>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
<style scoped lang="scss">
.code {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
