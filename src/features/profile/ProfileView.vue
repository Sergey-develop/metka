<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import FigureAvatar from '@/components/ui/FigureAvatar.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { USERNAME_RE } from '@/features/auth/messages'
import { toApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

const auth = useAuthStore()
const store = useProfileStore()

const editing = ref(false)
const name = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const signingOut = ref(false)

const p = computed(() => store.profile)
const initials = computed(() => {
  const parts = (p.value?.username ?? '?').split(/[_\s]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
})

onMounted(() => {
  if (!store.profile) void store.load()
})

function startEdit(): void {
  name.value = p.value?.username ?? ''
  saveError.value = null
  editing.value = true
}

async function save(): Promise<void> {
  if (!USERNAME_RE.test(name.value.trim())) {
    saveError.value = '3–24 символа: буквы, цифры, «_».'
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await store.rename(name.value.trim())
    editing.value = false
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
  <main class="page profile">
    <h1 class="profile__title">Профиль</h1>

    <StateBlock v-if="store.loading && !p" kind="loading" />
    <StateBlock v-else-if="!p" kind="error" title="Профиль не загружен" action-label="Повторить" @action="store.load()" />
    <template v-else>
      <section class="hero">
        <div class="avatar">
          <img v-if="p.avatarUrl" :src="p.avatarUrl" alt="" />
          <FigureAvatar v-else-if="p.avatarKey" class="avatar__figure" :figure="p.avatarKey" :size="104" />
          <span v-else aria-hidden="true">{{ initials }}</span>
          <button class="avatar__edit" aria-label="Изменить имя" @click="startEdit">
            <FilledIcon name="edit" :size="14" />
          </button>
        </div>
        <template v-if="!editing">
          <p class="hero__name">{{ p.username }}</p>
          <p class="hero__sub">Уровень {{ p.level }} · Москва</p>
        </template>
        <form v-else class="hero__form" @submit.prevent="save">
          <div class="field">
            <label for="name">Игровое имя</label>
            <input id="name" v-model="name" maxlength="24" />
          </div>
          <p v-if="saveError" class="notice notice--error">{{ saveError }}</p>
          <div class="hero__actions">
            <AppButton variant="secondary" @click="editing = false">Отмена</AppButton>
            <AppButton type="submit" :loading="saving">Сохранить</AppButton>
          </div>
        </form>
      </section>

      <section class="tile tile--wide account">
        <p class="muted">{{ auth.email }}</p>
        <AppButton block variant="danger" :loading="signingOut" @click="signOut">Выйти из аккаунта</AppButton>
      </section>
    </template>
  </main>
</template>

<style scoped lang="scss">
.profile {
  padding-left: 14px;
  padding-right: 14px;
}
.profile__title {
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 22px;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-bottom: 22px;
}
.avatar {
  position: relative;
  width: 104px;
  height: 104px;
  border-radius: 50%;
  background: #000;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 34px;
  font-weight: 700;
  margin-bottom: 14px;
  img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
}
.avatar__figure {
  border-radius: 50%;
}
.avatar__edit {
  position: absolute;
  right: -2px;
  bottom: 2px;
  width: 30px;
  height: 30px;
  border: 3px solid var(--c-bg);
  border-radius: 50%;
  background: var(--c-accent);
  color: #fff;
  display: grid;
  place-items: center;
  padding: 0;
}
.hero__name {
  font-size: 20px;
  font-weight: 700;
}
.hero__sub {
  font-size: 15px;
  color: var(--c-text-2);
}
.hero__form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.tile {
  background: var(--c-surface);
  border-radius: 26px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  &--wide {
    padding: 18px;
    margin-bottom: 12px;
  }
}
.account {
  gap: 12px;
  p {
    font-size: 13px;
  }
}
</style>
