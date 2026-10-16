<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import type { ApiErrorCode } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useClanStore } from '@/stores/clan'
import ClanAvatar from './ClanAvatar.vue'

const clan = useClanStore()
const auth = useAuthStore()
const router = useRouter()
const fileInput = ref<HTMLInputElement | null>(null)

const isOwner = computed(() => !!clan.membership && clan.membership.clan.ownerId === auth.userId)
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
const name = ref('')
const tag = ref('')

const ERRORS: Partial<Record<ApiErrorCode, string>> = {
  clan_taken: 'Название или тег уже заняты.',
  invalid_clan: 'Название 3–32 символа, тег 2–5 заглавных букв или цифр.',
  already_in_clan: 'Вы уже состоите в клане.',
  clan_full: 'В клане нет свободных мест.',
  clan_not_found: 'Клан не найден.',
  offline: 'Нет подключения к сети.',
}
const errorText = computed(() => (clan.error ? (ERRORS[clan.error.code] ?? 'Не удалось выполнить действие.') : null))
const canCreate = computed(() => name.value.trim().length >= 3 && /^[A-Za-z0-9А-Яа-яЁё]{2,5}$/.test(tag.value.trim()))

onMounted(() => void clan.load())

async function create(): Promise<void> {
  if (await clan.create(name.value.trim(), tag.value.trim().toUpperCase())) {
    name.value = ''
    tag.value = ''
  }
}
</script>

<template>
  <main class="page">
    <div class="head">
      <button class="back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1 class="page-title">Кланы</h1>
    </div>

    <p v-if="errorText" class="notice notice--error" role="alert">{{ errorText }}</p>
    <StateBlock v-if="clan.loading && !clan.membership && clan.ranking.length === 0" kind="loading" />
    <StateBlock
      v-else-if="clan.loadError && !clan.membership"
      kind="error"
      title="Не удалось загрузить кланы"
      action-label="Повторить"
      @action="clan.load()"
    />

    <section v-else-if="clan.membership" class="card block">
      <div class="clan-head">
        <div class="clan-pic">
          <ClanAvatar :url="clan.membership.clan.avatarUrl" :tag="clan.membership.clan.tag" :size="72" />
          <button
            v-if="isOwner"
            class="clan-pic__edit"
            :aria-label="clan.membership.clan.avatarUrl ? 'Сменить аватар клана' : 'Поставить аватар клана'"
            :disabled="clan.avatarBusy"
            @click="fileInput?.click()"
          >
            <FilledIcon name="edit" :size="13" />
          </button>
          <input ref="fileInput" type="file" accept="image/*" class="visually-hidden" tabindex="-1" @change="onAvatarPicked" />
        </div>
        <div class="clan-head__text">
          <p class="muted">Ваш клан</p>
          <h2 class="clan-name">[{{ clan.membership.clan.tag }}] {{ clan.membership.clan.name }}</h2>
          <button
            v-if="isOwner && clan.membership.clan.avatarUrl"
            class="link-btn"
            :disabled="clan.avatarBusy"
            @click="clan.removeAvatar()"
          >
            Убрать аватар
          </button>
          <span v-if="clan.avatarBusy" class="muted small">Загружаем…</span>
        </div>
      </div>
      <p v-if="avatarErrorText" class="notice notice--error" role="alert">{{ avatarErrorText }}</p>
      <ul class="rows">
        <li v-for="m in clan.membership.members" :key="m.userId">
          <span>{{ m.username }} <small v-if="m.role === 'owner'" class="muted">· лидер</small></span>
          <span class="muted">ур. {{ m.level }}</span>
        </li>
      </ul>
      <AppButton block variant="danger" :loading="clan.busy" @click="clan.leave()">Покинуть клан</AppButton>
    </section>

    <form v-else class="card block form" @submit.prevent="create">
      <h2 class="block__title">Создать клан</h2>
      <div class="field">
        <label for="clan-name">Название</label>
        <input id="clan-name" v-model="name" maxlength="32" />
      </div>
      <div class="field">
        <label for="clan-tag">Тег</label>
        <input id="clan-tag" v-model="tag" maxlength="5" autocapitalize="characters" />
      </div>
      <AppButton type="submit" block :loading="clan.busy" :disabled="!canCreate">Создать</AppButton>
    </form>

    <section v-if="!clan.loadError || clan.ranking.length > 0" class="card block">
      <h2 class="block__title">Рейтинг кланов по влиянию</h2>
      <p v-if="clan.ranking.length === 0" class="muted">Пока нет кланов.</p>
      <ol v-else class="rows">
        <li v-for="r in clan.ranking" :key="r.clanId">
          <span class="rank-name">
            {{ r.rank }}.
            <ClanAvatar :url="r.avatarUrl" :tag="r.tag" :size="28" />
            [{{ r.tag }}] {{ r.name }} <small class="muted">· {{ r.members }}</small>
          </span>
          <span class="right">
            <strong>{{ r.points }}</strong>
            <AppButton
              v-if="!clan.membership"
              variant="ghost"
              class="join"
              :disabled="clan.busy"
              @click="clan.join(r.clanId)"
            >
              Вступить
            </AppButton>
          </span>
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped lang="scss">
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  .page-title {
    margin: 0;
  }
}
.back {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: var(--c-surface);
  display: grid;
  place-items: center;
}
.block {
  padding: 16px;
  margin: 16px 0 0;
}
.block__title {
  font-size: 16px;
  font-weight: 700;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.clan-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}
.clan-head__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.clan-pic {
  position: relative;
}
.clan-pic__edit {
  position: absolute;
  right: -4px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 3px solid var(--c-surface);
  border-radius: 50%;
  background: var(--c-accent);
  color: #fff;
  display: grid;
  place-items: center;
}
.clan-name {
  font-size: 20px;
  font-weight: 700;
  margin: 2px 0 0;
}
.link-btn {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-accent);
  font-size: 13px;
  font-weight: 500;
}
.small {
  font-size: 13px;
}
.rank-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.rows {
  list-style: none;
  margin: 8px 0 12px;
  padding: 0;
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    font-size: 14px;
  }
}
.right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.join {
  height: 36px;
  padding: 0 10px;
  font-size: 14px;
}
</style>
