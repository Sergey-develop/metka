<script setup lang="ts">
import { computed, onMounted } from 'vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import ClanAvatar from '@/features/clans/ClanAvatar.vue'
import { useClanStore } from '@/stores/clan'
import { useMapStore } from '@/stores/map'
import { useProfileStore } from '@/stores/profile'

const store = useProfileStore()
const clan = useClanStore()
const map = useMapStore()

const p = computed(() => store.profile)

// game-wide progress: buildings discovered across all okrugs
const totalBuildings = computed(() => map.districts.reduce((sum, d) => sum + d.totalBuildings, 0))
const discovered = computed(() => p.value?.buildingsDiscovered ?? 0)
const ratio = computed(() => (totalBuildings.value > 0 ? Math.min(1, discovered.value / totalBuildings.value) : 0))
const DOTS = 34
const doneDots = computed(() => Math.round(ratio.value * (DOTS - 1)))

const influence = computed(() =>
  map.districts
    .filter((d) => d.myInfluence > 0)
    .sort((a, b) => b.myInfluence - a.myInfluence)
    .slice(0, 4),
)
const influenceTotal = computed(() => map.districts.reduce((sum, d) => sum + d.myInfluence, 0))
const xpLeft = computed(() => Math.max(0, store.progress.xpForNextLevel - store.progress.xpIntoLevel))

onMounted(() => {
  if (!store.profile) void store.load()
  void clan.load()
  if (map.districts.length === 0) void map.loadDistricts()
})
</script>

<template>
  <main class="page results">
    <h1 class="results__title">Результаты</h1>

    <StateBlock v-if="store.loading && !p" kind="loading" />
    <StateBlock v-else-if="!p" kind="error" title="Результаты не загружены" action-label="Повторить" @action="store.load()" />
    <template v-else>
      <!-- main game card: score board + run track -->
      <section class="tile tile--wide">
        <div class="board">
          <span class="board__score dots" :aria-label="`${p.xp} опыта`">{{ p.xp }}</span>
          <div class="board__caption">
            <small>Игра</small>
            <strong>Пройди все районы</strong>
          </div>
        </div>
        <div class="track-head">
          <span>Ваш прогресс:</span>
          <span><strong>{{ discovered }}</strong> <span class="muted">/ {{ totalBuildings }}</span></span>
        </div>
        <div
          class="track"
          role="progressbar"
          :aria-valuenow="discovered"
          :aria-valuemax="totalBuildings"
          aria-label="Открыто зданий из всех районов"
        >
          <template v-for="i in DOTS" :key="i">
            <FilledIcon v-if="i - 1 === doneDots" name="runner" :size="24" class="track__runner" />
            <span v-else class="track__dot" :class="{ 'track__dot--done': i - 1 < doneDots }" />
          </template>
        </div>
      </section>

      <div class="grid">
        <section class="tile">
          <div class="tile__head"><span class="chip">Опыт</span></div>
          <p class="tile__label">До уровня {{ p.level + 1 }}:</p>
          <p class="tile__big"><span class="dots">{{ xpLeft }}</span><small>XP</small></p>
        </section>

        <section class="tile">
          <div class="tile__head"><span class="chip">Монеты</span></div>
          <p class="tile__label">Баланс:</p>
          <p class="tile__big"><span class="dots">{{ p.coins }}</span><small>◎</small></p>
        </section>

        <section class="tile">
          <div class="tile__head">
            <span class="tile__place"><FilledIcon name="runner" :size="14" /> Влияние</span>
          </div>
          <p class="tile__big"><span class="dots">{{ influenceTotal }}</span></p>
          <ul v-if="influence.length" class="mini">
            <li v-for="d in influence" :key="d.id">
              <span>{{ d.shortName }}</span>
              <strong>{{ d.myInfluence }}</strong>
            </li>
          </ul>
          <p v-else class="tile__label">Откройте здание, чтобы получить влияние</p>
        </section>

        <section class="tile">
          <div class="tile__head"><span class="chip">Клан</span></div>
          <template v-if="clan.membership">
            <div class="tile__clan-row">
              <ClanAvatar :url="clan.membership.clan.avatarUrl" :tag="clan.membership.clan.tag" :size="32" />
              <p class="tile__clan">[{{ clan.membership.clan.tag }}] {{ clan.membership.clan.name }}</p>
            </div>
            <div class="pills">
              <span class="pill">{{ clan.membership.members.length }} уч.</span>
              <RouterLink to="/clan" class="pill">Открыть</RouterLink>
            </div>
          </template>
          <template v-else-if="clan.loadError">
            <p class="tile__label">Не удалось загрузить клан</p>
            <div class="pills">
              <button class="pill pill--wide" @click="clan.load()">Повторить</button>
            </div>
          </template>
          <template v-else>
            <p class="tile__label">Вы не в клане</p>
            <div class="pills">
              <RouterLink to="/clan" class="pill pill--wide">Найти клан</RouterLink>
            </div>
          </template>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped lang="scss">
.results {
  padding-left: 14px;
  padding-right: 14px;
}
.results__title {
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 22px;
}

.tile {
  background: var(--c-surface);
  border-radius: 26px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  &--wide {
    padding: 18px;
    margin-bottom: 12px;
    gap: 10px;
  }
}

.board {
  display: flex;
  align-items: center;
  gap: 14px;
}
.board__score {
  flex: none;
  min-width: 132px;
  padding: 8px 18px;
  border-radius: 16px;
  background: var(--c-accent);
  color: #fff;
  font-size: 40px;
  line-height: 1.05;
  text-align: center;
}
.board__caption {
  display: flex;
  flex-direction: column;
  small {
    font-size: 11px;
    color: var(--c-text-3);
  }
  strong {
    font-size: 14px;
    font-weight: 600;
  }
}
.track-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 14px;
  font-size: 12px;
  color: var(--c-text-2);
  strong {
    color: var(--c-text);
    font-size: 15px;
  }
}
.track {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
}
.track__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #d8d8de;
  &--done {
    background: var(--c-text);
  }
}
.track__runner {
  flex: none;
  color: var(--c-text);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.tile__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 24px;
}
.chip {
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--c-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.tile__place {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
  :deep(svg) {
    color: var(--c-accent);
  }
}
.tile__label {
  font-size: 12px;
  color: var(--c-text-2);
}
.tile__big {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 36px;
  line-height: 1;
  small {
    font-size: 13px;
    font-weight: 700;
  }
}
.tile__clan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tile__clan {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  li {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 10px;
    color: var(--c-text-2);
    strong {
      font-size: 12px;
      color: var(--c-text);
    }
  }
}
.pills {
  display: flex;
  gap: 6px;
  margin-top: auto;
}
.pill {
  flex: 1;
  border: 0;
  padding: 10px 6px;
  border-radius: 14px;
  background: #000;
  color: #fff;
  text-align: center;
  text-decoration: none;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  &--wide {
    flex: 1 1 100%;
  }
}
</style>
