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
import { useMapStore } from '@/stores/map'
import PageHero from '@/components/ui/PageHero.vue'
import ClanAvatar from './ClanAvatar.vue'
import { CLAN_HERO } from './clanPage'
import ClanPageBody from './ClanPageBody.vue'
import ClanSettingsSheet from './ClanSettingsSheet.vue'
import { plural } from '@/utils/plural'

const clan = useClanStore()
const auth = useAuthStore()
const map = useMapStore()
const router = useRouter()

const page = computed(() => clan.page)
const isOwner = computed(() => !!page.value && page.value.clan.ownerId === auth.userId)
const settingsOpen = ref(false)

const fmt = (n: number) => n.toLocaleString('ru-RU')

// ——— not in a clan: create one or join from the ranking ———
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

onMounted(() => {
  void clan.load({ page: true })
  if (map.districts.length === 0) void map.loadDistricts()
})

async function create(): Promise<void> {
  if (await clan.create(name.value.trim(), tag.value.trim().toUpperCase())) {
    name.value = ''
    tag.value = ''
  }
}
</script>

<template>
  <main v-if="page" class="page cp">
    <PageHero class="cp__hero" tone="sky" :height="CLAN_HERO.height" :row-y="CLAN_HERO.rowY" @back="router.back()">
      <template #right>
        <button aria-label="Настройки клана" @click="settingsOpen = true"><FilledIcon name="edit" :size="20" /></button>
      </template>
    </PageHero>

    <section class="who">
      <span class="who__crest"><ClanAvatar :url="page.clan.avatarUrl" :tag="page.clan.tag" :size="108" /></span>
      <h1 class="who__name">{{ page.clan.name }}</h1>
      <p class="who__sub">Клан</p>
      <p class="who__sub">{{ fmt(page.clan.members) }} {{ plural(page.clan.members, ['участник', 'участника', 'участников']) }}</p>
    </section>

    <ClanPageBody :page="page" />

    <Transition name="sheet">
      <ClanSettingsSheet v-if="settingsOpen" :is-owner="isOwner" :has-avatar="!!page.clan.avatarUrl" @close="settingsOpen = false" />
    </Transition>
  </main>

  <main v-else class="page">
    <div class="head">
      <button class="back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1 class="page-title">Кланы</h1>
    </div>

    <p v-if="errorText" class="notice notice--error" role="alert">{{ errorText }}</p>
    <StateBlock v-if="clan.loading && !clan.membership && clan.ranking.length === 0" kind="loading" />
    <StateBlock
      v-else-if="clan.loadError"
      kind="error"
      title="Не удалось загрузить кланы"
      action-label="Повторить"
      @action="clan.load({ page: true })"
    />
    <StateBlock v-else-if="clan.membership" kind="loading" />

    <template v-else>
      <form class="card block form" @submit.prevent="create">
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

      <section class="card block">
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
              <AppButton variant="ghost" class="join" :disabled="clan.busy" @click="clan.join(r.clanId)">Вступить</AppButton>
            </span>
          </li>
        </ol>
      </section>
    </template>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (клан.png)
$blue: #0189ff;
$card: #f9f9fc;
$ink: #212529;
$gray: #6d6d6e;

.cp {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 0;
  background: #fff;
}

.cp__hero {
  // the white body starts 24px above the hero's bottom (under its rounded corners) and the crest
  // overlaps the hero by 52px more, as in the mockup: gap 16 + 52 + 24
  margin: 0 -16px -92px;
}

.who {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 -16px;
  padding: 0 16px;
  &::before {
    // white sheet under the crest, as in the mockup
    content: '';
    position: absolute;
    inset: 52px 0 -16px;
    border-radius: 24px 24px 0 0;
    background: #fff;
  }
  > * {
    position: relative;
  }
}
.who__crest {
  width: 128px;
  height: 128px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e0eefc;
}
.who__name {
  margin-top: 14px;
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  color: #000;
  text-align: center;
}
.who__sub {
  margin-top: 2px;
  font-size: 13px;
  color: $gray;
}

// ——— not in a clan ———
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
