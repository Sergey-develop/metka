<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useClanStore } from '@/stores/clan'
import { useScrollLock } from '@/utils/scrollLock'

// the page behind stays still while this is open
useScrollLock()

/** Behind the pencil on the clan screen: clan avatar (leader only) and leaving the clan. */
const props = defineProps<{ isOwner: boolean; hasAvatar: boolean }>()
const emit = defineEmits<{ close: [] }>()

const clan = useClanStore()
const fileInput = ref<HTMLInputElement | null>(null)
const confirmLeave = ref(false)

const AVATAR_ERRORS: Record<string, string> = {
  not_image: 'Выберите картинку.',
  too_large: 'Картинка слишком большая.',
  unreadable: 'Не удалось прочитать картинку. Попробуйте другую.',
  not_clan_owner: 'Менять аватар может только лидер клана.',
  offline: 'Нет подключения к сети.',
}
const avatarErrorText = computed(() =>
  clan.avatarError ? (AVATAR_ERRORS[clan.avatarError] ?? 'Не удалось обновить аватар.') : null,
)

async function onAvatarPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow picking the same file again
  if (file) await clan.setAvatar(file)
}

async function leave(): Promise<void> {
  if (await clan.leave()) emit('close')
}
</script>

<template>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="clan-settings-title" @keydown.esc="$emit('close')" @click.self="$emit('close')">
    <div class="sheet__body">
      <h2 id="clan-settings-title" class="sheet__title">Клан</h2>

      <section v-if="props.isOwner" class="sheet__group">
        <h3>Аватар клана</h3>
        <input ref="fileInput" type="file" accept="image/*" class="visually-hidden" tabindex="-1" @change="onAvatarPicked" />
        <span v-if="clan.avatarBusy" class="muted">Загружаем…</span>
        <div v-else class="sheet__row">
          <AppButton variant="secondary" @click="fileInput?.click()">{{ props.hasAvatar ? 'Сменить аватар' : 'Поставить аватар' }}</AppButton>
          <AppButton v-if="props.hasAvatar" variant="ghost" @click="clan.removeAvatar()">Убрать</AppButton>
        </div>
        <p v-if="avatarErrorText" class="notice notice--error" role="alert">{{ avatarErrorText }}</p>
      </section>

      <section class="sheet__group">
        <p v-if="clan.error" class="notice notice--error" role="alert">Не удалось покинуть клан.</p>
        <template v-if="confirmLeave">
          <p>{{ props.isOwner ? 'Лидерство перейдёт к самому давнему участнику. Покинуть клан?' : 'Покинуть клан?' }}</p>
          <div class="sheet__row">
            <AppButton variant="danger" :loading="clan.busy" @click="leave">Покинуть</AppButton>
            <AppButton variant="ghost" @click="confirmLeave = false">Отмена</AppButton>
          </div>
        </template>
        <AppButton v-else block variant="danger" @click="confirmLeave = true">Покинуть клан</AppButton>
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

// <Transition name="sheet"> in ClanView: backdrop fades, the panel slides up from the bottom edge
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
