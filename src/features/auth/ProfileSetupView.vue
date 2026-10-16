<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import FigureAvatar from '@/components/ui/FigureAvatar.vue'
import { FIGURE_KEYS, type FigureKey } from '@/components/ui/figures'
import { ApiError, toApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { USERNAME_RE } from './messages'

// Registration step "game profile": nickname + preset avatar. Completed once per account.
const profile = useProfileStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const AVATAR_LABEL: Record<FigureKey, string> = {
  runner: 'Бегун',
  scooter: 'Самокатчик',
  skater: 'Скейтер',
  cyclist: 'Велосипедист',
}

// the generated fallback name (player_…) is not a real choice, so start empty
const current = profile.profile?.username ?? ''
const username = ref(/^player_[0-9a-f]{10}$/.test(current) ? '' : current)
const avatar = ref<FigureKey>(profile.profile?.avatarKey ?? 'runner')
const pending = ref(false)
const error = ref<string | null>(null)

const usernameValid = computed(() => USERNAME_RE.test(username.value.trim()))

function errorText(e: ApiError): string {
  if (e.code === 'username_taken') return 'Этот никнейм уже занят. Попробуйте другой.'
  if (e.code === 'invalid_profile' || e.code === 'validation') return 'Проверьте никнейм: 3–24 символа, буквы, цифры, «_».'
  if (e.code === 'offline' || e.code === 'network') return 'Нет связи с сервером. Проверьте интернет.'
  return 'Не удалось сохранить профиль. Попробуйте ещё раз.'
}

async function submit(): Promise<void> {
  if (!usernameValid.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await profile.completeSetup(username.value.trim(), avatar.value)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/map'
    await router.replace(redirect)
  } catch (e) {
    error.value = errorText(toApiError(e))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <h1 class="form__title">Игровой профиль</h1>
    <p class="form__lead">Никнейм увидят другие игроки в рейтингах районов и кланов.</p>

    <fieldset class="avatars">
      <legend class="avatars__legend">Аватар</legend>
      <label v-for="key in FIGURE_KEYS" :key="key" class="avatars__item" :class="{ 'avatars__item--on': avatar === key }">
        <input v-model="avatar" class="visually-hidden" type="radio" name="avatar" :value="key" />
        <span class="avatars__tile"><FigureAvatar :figure="key" :size="64" /></span>
        <span class="avatars__name">{{ AVATAR_LABEL[key] }}</span>
      </label>
    </fieldset>

    <div class="field">
      <label for="username">Никнейм</label>
      <input id="username" v-model="username" autocomplete="nickname" maxlength="24" required />
      <p class="form__hint">3–24 символа: буквы, цифры, «_». Сменить можно позже в профиле.</p>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <AppButton type="submit" block :loading="pending" :disabled="!usernameValid">Начать игру</AppButton>
    <AppButton variant="ghost" block @click="auth.signOut()">Выйти</AppButton>
  </form>
</template>

<style scoped lang="scss" src="./form.scss"></style>
<style scoped lang="scss">
.avatars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
}
.avatars__legend {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--c-text-2);
  padding-left: 4px;
}
.avatars__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.avatars__tile {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  outline: 3px solid transparent;
  outline-offset: 3px;
  transition:
    outline-color 0.15s var(--ease),
    transform 0.15s var(--ease);
}
.avatars__item--on .avatars__tile {
  outline-color: var(--c-accent);
}
.avatars__item:active .avatars__tile {
  transform: scale(0.96);
}
.avatars__item:has(input:focus-visible) .avatars__tile {
  outline-color: var(--c-accent-strong);
}
.avatars__name {
  font-size: 12px;
  color: var(--c-text-2);
}
.avatars__item--on .avatars__name {
  color: var(--c-text);
  font-weight: 600;
}
</style>
