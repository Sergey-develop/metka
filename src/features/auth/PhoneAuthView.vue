<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import type { OAuthProvider } from '@/app/config'
import AppButton from '@/components/ui/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText, RESEND_COOLDOWN_S, SMS_CODE_LENGTH } from './messages'
import { formatRuPhone, isCompleteRuPhone, ruPhoneDigits, ruPhoneE164 } from './phone'

// Phone + SMS code is both sign-in and sign-up: an unknown number gets a new account and then
// the "game profile" step (router guard). Mockups: Light/Sign In Screen_Default(-1).png.
const props = defineProps<{ mode: 'login' | 'register' }>()

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { config } = services()

const step = ref<'phone' | 'code'>('phone')
const digits = ref('')
const code = ref('')
const pending = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const cooldown = ref(0)
const codeInput = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const isLogin = computed(() => props.mode === 'login')
const submitLabel = computed(() => (isLogin.value ? 'Войти' : 'Продолжить'))
const formatted = computed(() => formatRuPhone(digits.value))
const canRequest = computed(() => isCompleteRuPhone(digits.value))
const canVerify = computed(() => new RegExp(`^\\d{${SMS_CODE_LENGTH}}$`).test(code.value))
const cooldownText = computed(() => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(cooldown.value / 60))}:${pad(cooldown.value % 60)}`
})

interface Tile {
  id: string
  label: string
  provider: OAuthProvider | null
}
// Yandex and VK are not Supabase providers: shown as "coming soon" until a server-side flow exists.
const tiles = computed<Tile[]>(() => {
  const on = (p: OAuthProvider): OAuthProvider | null => (config.oauthProviders.includes(p) ? p : null)
  const list: Tile[] = [
    { id: 'yandex', label: 'Яндекс', provider: null },
    { id: 'vk', label: 'VK', provider: null },
    { id: 'apple', label: 'Apple', provider: on('apple') },
  ]
  if (on('google')) list.push({ id: 'google', label: 'Google', provider: 'google' })
  if (on('github')) list.push({ id: 'github', label: 'GitHub', provider: 'github' })
  return list
})

function onPhoneInput(event: Event): void {
  const input = event.target as HTMLInputElement
  digits.value = ruPhoneDigits(input.value)
  // keep the field in sync even when the formatted text did not change (e.g. a rejected 11th digit)
  input.value = formatted.value
}

function onCodeInput(event: Event): void {
  const input = event.target as HTMLInputElement
  code.value = input.value.replace(/\D/g, '').slice(0, SMS_CODE_LENGTH)
  input.value = code.value
  if (canVerify.value) void verify()
}

function startCooldown(): void {
  cooldown.value = RESEND_COOLDOWN_S
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    cooldown.value--
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function requestCode(): Promise<void> {
  if (!canRequest.value || pending.value) return
  pending.value = true
  error.value = null
  notice.value = null
  try {
    await auth.requestPhoneCode(ruPhoneE164(digits.value))
    code.value = ''
    step.value = 'code'
    startCooldown()
    await nextTick()
    codeInput.value?.focus()
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    pending.value = false
  }
}

async function verify(): Promise<void> {
  if (!canVerify.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await auth.verifyPhoneCode(ruPhoneE164(digits.value), code.value)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/map'
    await router.replace(redirect)
  } catch (e) {
    error.value = authErrorText(e)
    code.value = ''
    codeInput.value?.focus()
  } finally {
    pending.value = false
  }
}

function back(): void {
  step.value = 'phone'
  code.value = ''
  error.value = null
}

async function oauth(tile: Tile): Promise<void> {
  error.value = null
  notice.value = null
  if (!tile.provider) {
    notice.value = `Вход через ${tile.label} появится позже.`
    return
  }
  try {
    await auth.signInWithOAuth(tile.provider)
  } catch (e) {
    error.value = authErrorText(e)
  }
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main class="phone-auth">
    <section class="hero">
      <button v-if="step === 'code'" class="hero__back" type="button" aria-label="Изменить номер" @click="back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m14.5 6-6 6 6 6" />
        </svg>
      </button>
      <h1 class="hero__title">{{ isLogin ? 'Вход' : 'Регистрация' }}</h1>

      <p v-if="auth.sessionExpired" class="hero__notice">Сессия истекла. Войдите снова.</p>
      <p v-if="route.query.error === 'callback'" class="hero__notice">Не удалось завершить вход по ссылке.</p>

      <form v-if="step === 'phone'" class="hero__form" novalidate @submit.prevent="requestCode">
        <label class="hero__label" for="phone">Номер телефона</label>
        <div class="phone-field">
          <svg class="phone-field__flag" width="21" height="15" viewBox="0 0 21 15" aria-label="Россия, +7" role="img">
            <clipPath id="flag-clip"><rect width="21" height="15" rx="2.5" /></clipPath>
            <g clip-path="url(#flag-clip)">
              <rect width="21" height="5" fill="#fff" />
              <rect y="5" width="21" height="5" fill="#0c47b7" />
              <rect y="10" width="21" height="5" fill="#e53b35" />
            </g>
          </svg>
          <span class="phone-field__divider" aria-hidden="true" />
          <input
            id="phone"
            :value="formatted"
            type="tel"
            inputmode="tel"
            autocomplete="tel-national"
            placeholder="(999) 999-99-99"
            required
            @input="onPhoneInput"
          />
        </div>
        <AppButton class="hero__submit" type="submit" block :loading="pending" :disabled="!canRequest">{{ submitLabel }}</AppButton>
      </form>

      <form v-else class="hero__form" novalidate @submit.prevent="verify">
        <p class="hero__lead">
          Введите код подтверждения, отправленный на номер<br />
          <strong>+7 {{ formatted }}</strong>
        </p>
        <label class="code" :style="{ '--cells': SMS_CODE_LENGTH }">
          <span class="visually-hidden">Код из SMS</span>
          <input
            ref="codeInput"
            class="code__input"
            :value="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            :maxlength="SMS_CODE_LENGTH"
            @input="onCodeInput"
          />
          <span
            v-for="i in SMS_CODE_LENGTH"
            :key="i"
            class="code__cell"
            :class="{ 'code__cell--now': i - 1 === code.length }"
            aria-hidden="true"
          >{{ code[i - 1] ?? '' }}</span>
        </label>
        <p class="hero__resend">
          <template v-if="cooldown > 0">Отправить код повторно через {{ cooldownText }}</template>
          <button v-else type="button" :disabled="pending" @click="requestCode">Отправить код повторно</button>
        </p>
        <AppButton class="hero__submit" type="submit" block :loading="pending" :disabled="!canVerify">{{ submitLabel }}</AppButton>
      </form>

      <p v-if="error" class="hero__error" role="alert">{{ error }}</p>
      <p class="hero__policy">
        Нажимая кнопку «{{ submitLabel }}», вы принимаете условия
        <a v-if="config.privacyPolicyUrl" :href="config.privacyPolicyUrl" target="_blank" rel="noopener">Политики конфиденциальности</a>
        <strong v-else>Политики конфиденциальности</strong>
      </p>
    </section>

    <section class="alt">
      <p class="alt__title">Или войти через</p>
      <div class="alt__tiles">
        <button
          v-for="t in tiles"
          :key="t.id"
          type="button"
          class="tile"
          :class="{ 'tile--soon': !t.provider }"
          :aria-label="t.provider ? `Войти через ${t.label}` : `${t.label} — скоро`"
          :aria-disabled="!t.provider"
          @click="oauth(t)"
        >
          <svg v-if="t.id === 'yandex'" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#fc3f1d" />
            <text x="12" y="17.2" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#fff">Я</text>
          </svg>
          <svg v-else-if="t.id === 'vk'" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" fill="#fff" />
            <path
              fill="#0077ff"
              d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.204.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.254-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.763-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z"
            />
          </svg>
          <svg v-else-if="t.id === 'apple'" width="22" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#000"
              d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
            />
          </svg>
          <span v-else class="tile__text">{{ t.label }}</span>
          <span v-if="!t.provider" class="tile__soon" aria-hidden="true">скоро</span>
        </button>
      </div>
      <p v-if="notice" class="alt__notice" role="status">{{ notice }}</p>
      <RouterLink class="alt__email" :to="{ name: isLogin ? 'login-email' : 'register-email', query: route.query }">
        {{ isLogin ? 'Войти по почте' : 'Регистрация по почте' }}
      </RouterLink>
    </section>

    <footer class="foot">
      <template v-if="isLogin">
        Нет аккаунта? <RouterLink :to="{ name: 'register' }">Зарегистрироваться</RouterLink>
      </template>
      <template v-else>
        Уже есть аккаунт? <RouterLink :to="{ name: 'login' }">Войти</RouterLink>
      </template>
    </footer>
  </main>
</template>

<style scoped lang="scss">
/* Sizes follow the mockup (390pt-wide screen). */
.phone-auth {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: #f3f3f9;
  // mockup typeface is SF Pro: system font on Apple devices, Inter elsewhere (SF Pro can't be bundled)
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', var(--font);
}

.hero {
  position: relative;
  padding: calc(var(--safe-top) + 100px) 16px 40px;
  background: linear-gradient(180deg, #0189ff 0%, #0189ff 20%, #a3dbff 100%);
  border-radius: 0 0 56px 56px;
  color: #fff;
  text-align: center;
}
.hero__back {
  position: absolute;
  top: calc(var(--safe-top) + 10px);
  left: 16px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 40%);
  border-radius: 50%;
  background: rgb(255 255 255 / 20%);
  color: #fff;
}
.hero__title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 40px;
}
.hero__form {
  display: flex;
  flex-direction: column;
  text-align: left;
}
.hero__label {
  font-size: 13px;
  margin-bottom: 8px;
  color: rgb(255 255 255 / 90%);
}
.hero__lead {
  margin-top: -18px;
  margin-bottom: 18px;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  strong {
    font-weight: 600;
  }
}
.hero__notice,
.hero__error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgb(255 255 255 / 92%);
  color: var(--c-danger);
  font-size: 13px;
}
.hero__error {
  margin: 14px 0 0;
}
.hero__notice {
  color: var(--c-warning);
}
.hero .hero__submit {
  height: 56px;
  margin-top: 16px;
  border-radius: 12px;
  background: #fff;
  color: #000;
  font-size: 17px;
  font-weight: 500;
  &:disabled {
    opacity: 1;
    color: rgb(0 0 0 / 35%);
  }
}
.hero__resend {
  margin-top: 16px;
  font-size: 13px;
  text-align: center;
  button {
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
  }
}
.hero__policy {
  margin-top: 16px;
  font-size: 12px;
  line-height: 17px;
  color: rgb(255 255 255 / 75%);
  a,
  strong {
    color: #fff;
    font-weight: 500;
    text-decoration: none;
  }
}

.phone-field {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px 0 24px;
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 12px;
  background: rgb(255 255 255 / 20%);
  &:focus-within {
    border-color: rgb(255 255 255 / 70%);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 17px;
    &::placeholder {
      color: rgb(255 255 255 / 45%);
    }
  }
}
.phone-field__flag {
  flex: none;
}
.phone-field__divider {
  width: 1.5px;
  height: 22px;
  margin: 0 14px;
  background: rgb(255 255 255 / 60%);
}

.code {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--cells), 48px);
  justify-content: center;
  gap: 8px;
}
// one real input under the cells: SMS autofill ("one-time-code") and paste work as usual
.code__input {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  border: 0;
  font-size: 16px; // no zoom on focus in iOS Safari
  caret-color: transparent;
}
.code__cell {
  height: 56px;
  display: grid;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 10px;
  background: rgb(255 255 255 / 20%);
  font-size: 22px;
  font-weight: 600;
  pointer-events: none;
}
.code__input:focus ~ .code__cell--now {
  border-color: #fff;
}

.alt {
  padding: 40px 16px 0;
  text-align: center;
}
.alt__title {
  font-size: 13px;
  color: #8e8e93;
  margin-bottom: 12px;
}
.alt__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 8px;
}
.tile {
  position: relative;
  height: 56px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #e4e4ea;
  transition: transform 0.12s var(--ease);
  &:active {
    transform: scale(0.97);
  }
  &--soon svg {
    opacity: 0.45;
  }
}
.tile__text {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
}
.tile__soon {
  position: absolute;
  top: 5px;
  right: 6px;
  font-size: 10px;
  color: #8e8e93;
}
.alt__notice {
  margin-top: 12px;
  font-size: 13px;
  color: var(--c-text-2);
}
.alt__email {
  display: inline-block;
  margin-top: 20px;
  font-size: 14px;
  color: var(--c-text-2);
}

.foot {
  margin-top: auto;
  padding: 32px 16px calc(max(var(--safe-bottom), 20px) + 24px);
  text-align: center;
  font-size: 15px;
  color: #8e8e93;
  a {
    color: #0a84ff;
    font-weight: 500;
    text-decoration: none;
  }
}
</style>
