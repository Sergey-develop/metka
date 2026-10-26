<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import type { FilledIconName } from '@/components/ui/icons'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import MoscowMapCard from '@/features/profile/MoscowMapCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useMapStore } from '@/stores/map'
import type { ClanPage } from '@/types/game'
import { chronicleText, chronicleTime, clanMetrics, daysLeftText, goalTitle as goalTitleOf, weeklyRanking } from './clanPage'

/**
 * The clan page below the crest and the name (mockup клан.png): goal and leaders of the week,
 * territory, metrics, members, chronicle. Shared by the clan page and the clan sheet on the map, so
 * an expanded sheet already is the page — nothing is swapped and nothing jumps.
 */
const props = defineProps<{ page: ClanPage }>()

const auth = useAuthStore()
const map = useMapStore()
const allMembers = ref(false)

const fmt = (n: number) => n.toLocaleString('ru-RU')
const daysLeft = daysLeftText
const goalTitle = computed(() => goalTitleOf(props.page))

const ranking = computed(() => weeklyRanking(props.page.members))
const leaders = computed(() => ranking.value.filter((m) => m.weekCells > 0).slice(0, 3))
const MEMBERS_PREVIEW = 3
const shownMembers = computed(() => (allMembers.value ? ranking.value : ranking.value.slice(0, MEMBERS_PREVIEW)))

const metrics = computed(() => clanMetrics(props.page))

const roleLabel = (m: ClanPage['members'][number]) => (m.role === 'owner' ? 'Глава клана' : `${m.level} уровень`)
/** own row → own profile; others → their profile (clanmates only) */
const profileLink = (userId: string) => (userId === auth.userId ? '/profile' : `/players/${userId}`)
const chronicleIcon = (e: ClanPage['chronicle'][number]): FilledIconName =>
  e.kind === 'joined' ? 'profile' : e.rarity === 'legendary' ? 'collection' : 'pin'

onMounted(() => {
  if (map.districts.length === 0) void map.loadDistricts()
})
</script>

<template>
  <div class="body">
    <section class="card goal">
      <p class="card__meta">
        <span>Общая цель недели</span><span>{{ daysLeft(page) }}</span>
      </p>
      <h2 class="card__title">{{ goalTitle }}</h2>
      <div class="goal__row">
        <div
          class="goal__track"
          role="progressbar"
          :aria-valuenow="page.week.goal.progress"
          :aria-valuemax="page.week.goal.target"
          aria-label="Цель недели"
        >
          <span :style="{ width: `${Math.min(1, page.week.goal.progress / Math.max(1, page.week.goal.target)) * 100}%` }" />
        </div>
        <p class="goal__num">
          {{ fmt(page.week.goal.progress) }}<small>/{{ fmt(page.week.goal.target) }}</small>
        </p>
      </div>
    </section>

    <section class="card">
      <p class="card__meta">
        <span>Количество клеток</span><span>{{ daysLeft(page) }}</span>
      </p>
      <h2 class="card__title">Лидеры недели</h2>
      <ul v-if="leaders.length" class="leaders">
        <li v-for="m in leaders" :key="m.userId">
          <RouterLink :to="profileLink(m.userId)" class="leaders__link">
            <PlayerAvatar class="face face--sm" :url="m.avatarUrl" :figure="m.avatarKey" :name="m.username" :size="38" />
            <span class="leaders__text">
              <b>{{ m.share }}%</b>
              <small>{{ m.username }}</small>
            </span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="card__empty">На этой неделе клетки ещё никто не открыл.</p>
    </section>

    <section class="section">
      <h2 class="section__title">Территория клана</h2>
      <div class="territory">
        <MoscowMapCard :districts="map.districts" :highlight="page.ownedDistrictIds">
          <span class="visually-hidden">
            {{ page.ownedDistrictIds.length ? `Округов во владении: ${page.ownedDistrictIds.length}` : 'Клан пока не владеет округами' }}
          </span>
        </MoscowMapCard>
        <RouterLink to="/map" class="territory__link"><FilledIcon name="pin" :size="16" />Смотреть на карте</RouterLink>
      </div>
    </section>

    <section class="section">
      <h2 class="section__title">Метрики клана</h2>
      <div class="metrics">
        <div v-for="m in metrics" :key="m.label" class="metric">
          <span class="metric__icon" :class="`metric__icon--${m.tone}`"><FilledIcon :name="m.icon" :size="16" /></span>
          <p class="metric__num">{{ m.value }}<small v-if="m.unit">{{ ` ${m.unit}` }}</small></p>
          <p class="metric__label">{{ m.label }}</p>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section__title">
        Участники <small>{{ page.clan.members }}/{{ page.clan.maxMembers }}</small>
      </h2>
      <ul class="members">
        <li v-for="m in shownMembers" :key="m.userId">
          <RouterLink :to="profileLink(m.userId)" class="member">
            <PlayerAvatar class="face" :url="m.avatarUrl" :figure="m.avatarKey" :name="m.username" :size="52" />
            <span class="member__who">
              <b>{{ m.username }}</b>
              <small>{{ roleLabel(m) }}</small>
            </span>
            <span class="member__week">
              <b>{{ m.share }}%</b>
              <small>клеток недели</small>
            </span>
          </RouterLink>
        </li>
      </ul>
      <AppButton v-if="ranking.length > MEMBERS_PREVIEW" block class="members__all" @click="allMembers = !allMembers">
        {{ allMembers ? 'Свернуть' : 'Все участники' }}
      </AppButton>
    </section>

    <section class="section">
      <h2 class="section__title">Летопись</h2>
      <ul class="chronicle">
        <li v-for="(e, i) in page.chronicle" :key="i" class="entry">
          <span class="entry__icon" :class="`entry__icon--${e.kind === 'joined' ? 'join' : e.rarity}`">
            <FilledIcon :name="chronicleIcon(e)" :size="22" />
          </span>
          <span class="entry__text">
            <small>{{ chronicleTime(e.at) }}</small>
            <b>{{ chronicleText(e) }}</b>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (клан.png)
$blue: #0189ff;
$card: #f9f9fc;
$ink: #212529;
$gray: #6d6d6e;

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  padding: 16px 12px;
  border-radius: 12px;
  background: $card;
}
.card__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: $gray;
}
.card__title {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  color: #000;
}
.card__empty {
  margin-top: 12px;
  font-size: 13px;
  color: $gray;
}

.goal__row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
}
.goal__track {
  flex: 1;
  height: 16px;
  border-radius: 8px;
  background: #e0eefc;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    border-radius: 8px;
    background: $blue;
  }
}
.goal__num {
  font-size: 24px;
  font-weight: 700;
  color: $blue;
  small {
    font-size: 13px;
    font-weight: 500;
  }
}

.leaders {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
.leaders__link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
}
.leaders__text {
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

.face {
  flex: 0 0 52px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #e0eefc;
  color: $blue;
  font-size: 18px;
  font-weight: 700;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.face--sm {
  flex-basis: 38px;
  width: 38px;
  height: 38px;
  font-size: 15px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
.section__title {
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  color: #000;
  small {
    margin-left: 4px;
    font-size: 13px;
    font-weight: 400;
    color: $gray;
  }
}

.territory {
  position: relative;
}
.territory__link {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 12px 0 12px 0;
  background: #fff;
  color: #000;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
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
  margin-top: 22px;
  font-size: 34px;
  font-weight: 700;
  line-height: 40px;
  color: $ink;
  small {
    font-size: 15px;
    font-weight: 500;
  }
}
.metric__label {
  font-size: 13px;
  color: #495057;
}

.members,
.chronicle {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.member {
  display: flex;
  color: inherit;
  text-decoration: none;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: $card;
}
.member__who,
.member__week {
  display: flex;
  flex-direction: column;
  b {
    font-size: 17px;
    font-weight: 600;
  }
  small {
    font-size: 13px;
    color: $gray;
  }
}
.member__who {
  flex: 1;
  min-width: 0;
  b {
    color: #000;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.member__week {
  align-items: flex-end;
  b {
    font-size: 20px;
    color: $blue;
  }
}
.members__all {
  margin-top: 2px;
}

.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  background: $card;
}
.entry__icon {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 3px solid #f2b705;
  border-radius: 12px;
  background: #2f7de1;
  color: #fff;
}
.entry__icon--join {
  background: #1fa363;
}
.entry__icon--legendary {
  background: #f2b705;
  border-color: #c98a00;
}
.entry__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  small {
    font-size: 13px;
    color: $gray;
  }
  b {
    font-size: 15px;
    font-weight: 500;
    color: #000;
  }
}
</style>
