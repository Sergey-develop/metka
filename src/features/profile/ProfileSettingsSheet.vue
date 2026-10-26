<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { USERNAME_RE } from '@/features/auth/messages'
import { toApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { useScrollLock } from '@/utils/scrollLock'

// the page behind stays still while this is open
useScrollLock()

/** Account settings behind the gear on the profile screen: photo, game name, sign out. */
defineEmits<{ close: [] }>()

const auth = useAuthStore()
const store = useProfileStore()

const p = computed(() => store.profile)
const name = ref(p.value?.username ?? '')
const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)
const signingOut = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const AVATAR_ERRORS: Record<string, string> = {
  not_image: 'Выберите картинку.',
  too_large: 'Картинка слишком большая.',
  unreadable: 'Не удалось прочитать картинку. Попробуйте другую.',
  offline: 'Нет подключения к сети.',
}
const avatarErrorText = computed(() =>
  store.avatarError ? (AVATAR_ERRORS[store.avatarError] ?? 'Не удалось обновить фото.') : null,
)

async function onAvatarPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow picking the same file again
  if (file) await store.setAvatar(file)
}

async function save(): Promise<void> {
  saved.value = false
  if (!USERNAME_RE.test(name.value.trim())) {
    saveError.value = '3–24 символа: буквы, цифры, «_».'
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await store.rename(name.value.trim())
    saved.value = true
  } catch (e) {
    saveError.value = toApiError(e).code === 'conflict' ? 'Это имя уже занято.' : 'Не удалось сохранить.'
  } finally {
    saving.value = false
  }
}

async function signOut(): Promise<void> {
  signingOut.value = true
  try {
    await auth.signOut()
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" @keydown.esc="$emit('close')" @click.self="$emit('close')">
    <div class="sheet__body">
      <h2 id="settings-title" class="sheet__title">Настройки</h2>

      <section class="sheet__group">
        <h3>Фото профиля</h3>
        <input ref="fileInput" type="file" accept="image/*" class="visually-hidden" tabindex="-1" @change="onAvatarPicked" />
        <span v-if="store.avatarBusy" class="muted">Загружаем…</span>
        <div v-else class="sheet__row">
          <AppButton variant="secondary" @click="fileInput?.click()">{{ p?.avatarUrl ? 'Сменить фото' : 'Загрузить фото' }}</AppButton>
          <AppButton v-if="p?.avatarUrl" variant="ghost" @click="store.removeAvatar()">Убрать фото</AppButton>
        </div>
        <p v-if="avatarErrorText" class="notice notice--error" role="alert">{{ avatarErrorText }}</p>
      </section>

      <form class="sheet__group" @submit.prevent="save">
        <div class="field">
          <label for="name">Игровое имя</label>
          <input id="name" v-model="name" maxlength="24" @input="saved = false" />
        </div>
        <p v-if="saveError" class="notice notice--error">{{ saveError }}</p>
        <p v-else-if="saved" class="muted">Сохранено</p>
        <AppButton type="submit" :loading="saving">Сохранить имя</AppButton>
      </form>

      <section class="sheet__group">
        <p class="muted">{{ auth.email }}</p>
        <AppButton block variant="danger" :loading="signingOut" @click="signOut">Выйти из аккаунта</AppButton>
      </section>

      <AppButton block variant="ghost" @click="$emit('close')">Закрыть</AppButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.sheet {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(17 19 23 / 40%);
}

// <Transition name="sheet"> in ProfileView: backdrop fades, the panel slides up from the bottom edge
.sheet-enter-active,
.sheet-leave-active {
  transition: background-color 0.32s var(--ease);
  .sheet__body {
    transition: transform 0.32s var(--ease);
  }
}
.sheet-leave-active {
  transition-duration: 0.24s;
  .sheet__body {
    transition: transform 0.24s cubic-bezier(0.4, 0, 1, 1);
  }
}
.sheet-enter-from,
.sheet-leave-to {
  background-color: rgb(17 19 23 / 0%);
  .sheet__body {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet__body,
  .sheet-leave-active .sheet__body {
    transition-duration: 0.01s;
  }
}

.sheet__body {
  width: 100%;
  max-width: 560px;
  max-height: 90%;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 18px calc(var(--safe-bottom) + 18px);
  border-radius: 24px 24px 0 0;
  background: var(--c-surface);
}
.sheet__title {
  font-size: 20px;
  font-weight: 600;
}
.sheet__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  h3 {
    font-size: 15px;
    font-weight: 600;
  }
  p {
    font-size: 13px;
  }
}
.sheet__row {
  display: flex;
  gap: 8px;
}
</style>
