<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import PageHero from '@/components/ui/PageHero.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import ClanAvatar from '@/features/clans/ClanAvatar.vue'
import ClanPageBody from '@/features/clans/ClanPageBody.vue'
import ClanSettingsSheet from '@/features/clans/ClanSettingsSheet.vue'
import { CLAN_HERO, clanMetrics, daysLeftText, goalTitle, weeklyRanking } from '@/features/clans/clanPage'
import { useAuthStore } from '@/stores/auth'
import { useClanStore } from '@/stores/clan'
import { plural } from '@/utils/plural'

/**
 * The clan over the map. Half open it is the mockup «выдвигается клан»: crest, name, the goal of the
 * week with the members' contributions, metrics. Swiped up (or by the metrics
 * chevron) it expands in place into the whole clan page (клан.png, ClanPageBody) without opening /clan:
 * the sheet stops where the page's white body starts (PAGE_TOP), the crest and the name sit exactly
 * where the page has them, and the page's header (with the settings button) shows behind it.
 */
const emit = defineEmits<{ close: [] }>()

const clan = useClanStore()
const auth = useAuthStore()
const page = computed(() => clan.page)
const contributors = computed(() => (page.value ? weeklyRanking(page.value.members).filter((m) => m.weekCells > 0).slice(0, 3) : []))
const metrics = computed(() => (page.value ? clanMetrics(page.value) : []))
const ratio = computed(() => (page.value ? Math.min(1, page.value.week.goal.progress / Math.max(1, page.value.week.goal.target)) : 0))
const fmt = (n: number) => n.toLocaleString('ru-RU')
const profileLink = (userId: string) => (userId === auth.userId ? '/profile' : `/players/${userId}`)
const isOwner = computed(() => !!page.value && page.value.clan.ownerId === auth.userId)
const settingsOpen = ref(false)

/** px below the safe area where the clan page's white body starts: the bottom of its header */
const PAGE_TOP = CLAN_HERO.bodyTop

onMounted(() => void clan.load({ page: true }))
</script>

<template>
  <BottomSheet label="Клан" :top-room="PAGE_TOP" @close="emit('close')">
    <template v-if="page" #backdrop="{ expanded }">
      <PageHero tone="sky" :height="CLAN_HERO.height" :row-y="CLAN_HERO.rowY">
        <template #right>
          <!-- usable only once the header is fully shown (the backdrop itself ignores the pointer) -->
          <button :class="{ live: expanded }" :tabindex="expanded ? 0 : -1" aria-label="Настройки клана" @click="settingsOpen = true"><FilledIcon name="edit" :size="20" /></button>
        </template>
      </PageHero>
    </template>
    <template v-if="page" #top>
      <span class="crest"><ClanAvatar :url="page.clan.avatarUrl" :tag="page.clan.tag" :size="108" /></span>
    </template>

    <template #default="{ expanded, expand }">
      <StateBlock v-if="clan.loading && !page && !clan.membership" kind="loading" />
      <StateBlock v-else-if="clan.loadError && !page" kind="error" title="Не удалось загрузить клан" action-label="Повторить" @action="clan.load({ page: true })" />
      <section v-else-if="!clan.membership" class="none">
        <h2>Ты пока не в клане</h2>
        <p>Вступи в клан или создай свой — исследуйте Москву вместе.</p>
        <RouterLink v-slot="{ navigate }" to="/clan" custom>
          <AppButton block @click="emit('close'), navigate()">Найти клан</AppButton>
        </RouterLink>
      </section>
      <StateBlock v-else-if="!page" kind="loading" />

      <template v-else-if="expanded">
        <header class="who who--page">
          <h2 class="who__name">{{ page.clan.name }}</h2>
          <p class="who__sub">Клан</p>
          <p class="who__sub">{{ fmt(page.clan.members) }} {{ plural(page.clan.members, ['участник', 'участника', 'участников']) }}</p>
        </header>
        <ClanPageBody :page="page" />
      </template>

      <template v-else>
        <header class="who">
          <h2 class="who__name">{{ page.clan.name }}</h2>
          <p class="who__sub">Клан</p>
        </header>

        <section class="goal">
          <p class="goal__meta"><span>Общая цель недели</span><span>{{ daysLeftText(page) }}</span></p>
          <h3 class="goal__title">{{ goalTitle(page) }}</h3>
          <div class="bar" role="progressbar" :aria-valuenow="page.week.goal.progress" :aria-valuemax="page.week.goal.target" aria-label="Цель недели">
            <span class="bar__fill" :style="{ width: `${ratio * 100}%` }">
              <b v-if="ratio >= 0.15">{{ fmt(page.week.goal.progress) }}</b>
            </span>
            <!-- the target sits in the unfilled part; nearly or fully reached, there is no room for it -->
            <b v-if="ratio < 0.85" class="bar__rest">{{ fmt(page.week.goal.target) }}</b>
          </div>
          <p class="goal__num">{{ fmt(page.week.goal.progress) }}<small>/{{ fmt(page.week.goal.target) }}</small></p>

          <p class="goal__meta goal__meta--sub">Вклад участников</p>
          <ul v-if="contributors.length" class="contrib">
            <li v-for="m in contributors" :key="m.userId">
              <RouterLink :to="profileLink(m.userId)" class="contrib__link" @click="emit('close')">
                <PlayerAvatar class="face" :url="m.avatarUrl" :figure="m.avatarKey" :name="m.username" :size="40" />
                <span class="contrib__text"><b>{{ m.share }}%</b><small>{{ m.username }}</small></span>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="goal__empty">На этой неделе клетки ещё никто не открыл.</p>
        </section>

        <section class="metrics-block">
          <div class="metrics-block__head">
            <h3>Метрики клана</h3>
            <button class="more" aria-label="Открыть страницу клана" @click="expand()"><AppIcon name="chevron" :size="18" /></button>
          </div>
          <div class="metrics">
            <div v-for="m in metrics" :key="m.label" class="metric">
              <span class="metric__icon" :class="`metric__icon--${m.tone}`"><FilledIcon :name="m.icon" :size="16" /></span>
              <p class="metric__num">{{ m.value }}<small v-if="m.unit">{{ ` ${m.unit}` }}</small></p>
              <p class="metric__label">{{ m.label }}</p>
            </div>
          </div>
        </section>
      </template>
    </template>
  </BottomSheet>

  <!-- to the body: inside the map page it would sit under the tab bar (its z-index 50 counts only there) -->
  <Teleport to="body">
    <Transition name="sheet">
      <ClanSettingsSheet v-if="settingsOpen && page" :is-owner="isOwner" :has-avatar="!!page.clan.avatarUrl" @close="settingsOpen = false" />
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (выдвигается клан.png); crest and name match ClanView exactly
$blue: #0189ff;
$card: #f8f8fa;
$gray: #6d6d6e;

// the header's settings button, once the sheet is expanded into the page
.live {
  pointer-events: auto;
}

// the crest covers the grip, as in the mockup (the sheet is still dragged by its content)
:deep(.bsheet__grip span) {
  opacity: 0;
}

.none {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0 4px;
  h2 {
    font-size: 20px;
    font-weight: 600;
  }
  p {
    margin-bottom: 8px;
    font-size: 15px;
    color: $gray;
  }
}

// same size and place as on the clan page: 52px above the white edge, the grip (28px) under its foot
.crest {
  align-self: center;
  width: 128px;
  height: 128px;
  margin: -52px 0 -28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e0eefc;
  position: relative;
  z-index: 1;
  pointer-events: none;
}
.who {
  display: flex;
  flex-direction: column;
  align-items: center;
  // the goal card starts where the page has it (the page shows one more line: the members count)
  margin-bottom: 36px;
}
// expanded: the page's header has one more line (members), so the goal card stays where it was
.who--page {
  margin-bottom: 16px;
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

.goal {
  padding: 16px 12px;
  border-radius: 12px;
  background: $card;
}
.goal__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: $gray;
}
.goal__meta--sub {
  margin-top: 16px;
}
.goal__title {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 600;
  line-height: 22px;
  color: #000;
}
.bar {
  display: flex;
  align-items: center;
  height: 24px;
  margin-top: 18px;
  border-radius: 12px;
  background: #e0eefc;
  overflow: hidden;
  font-size: 11px;
}
.bar__fill {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: 12px;
  background: $blue;
  color: #fff;
}
.bar__rest {
  flex: 1;
  text-align: center;
  color: $blue;
}
.goal__num {
  margin-top: 6px;
  font-size: 24px;
  font-weight: 700;
  color: $blue;
  small {
    margin-left: 4px;
    font-size: 13px;
    font-weight: 500;
  }
}
.goal__empty {
  margin-top: 10px;
  font-size: 13px;
  color: $gray;
}
.contrib {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.contrib__link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
}
.contrib__text {
  display: flex;
  flex-direction: column;
  b {
    font-size: 15px;
    font-weight: 600;
    color: #000;
  }
  small {
    font-size: 13px;
    color: $gray;
  }
}

.metrics-block {
  margin-top: 24px;
}
.metrics-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  h3 {
    font-size: 20px;
    font-weight: 600;
    color: #000;
  }
}
.more {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #eeeef3;
  color: #000;
}
.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.metric {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 10px;
  background: $card;
}
.metric__icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #000;
}
.metric__icon--blue {
  background: #cfe6fc;
}
.metric__icon--yellow {
  background: #ffe066;
}
.metric__icon--pink {
  background: #f8d4f4;
}
.metric__icon--red {
  background: #ffc9c9;
}
.metric__num {
  margin-top: 18px;
  font-size: 30px;
  font-weight: 700;
  line-height: 36px;
  color: #212529;
  small {
    font-size: 15px;
    font-weight: 500;
  }
}
.metric__label {
  font-size: 13px;
  color: #495057;
}
</style>
