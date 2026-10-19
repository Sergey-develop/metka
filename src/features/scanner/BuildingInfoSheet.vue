<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import type { InfoEntry } from '@/stores/buildingInfo'
import type { BuildingOrganization, BuildingOutline } from '@/types/game'

/**
 * Info card of one building over the camera (or the map). Shows only what the data has:
 * missing blocks are hidden, never filled with guesses.
 */
const props = defineProps<{
  outline: BuildingOutline
  info: InfoEntry | null
  /** organisations inside; null — not loaded / not available yet */
  organizations: BuildingOrganization[] | null
  organizationsLoading?: boolean
  /** shown only when position and heading are precise enough; null hides it */
  distanceM: number | null
  expanded: boolean
}>()
const emit = defineEmits<{
  'update:expanded': [value: boolean]
  retry: []
  /** open the existing verified scan flow (/scan/:buildingId) */
  scan: [gameBuildingId: string]
  memory: []
  close: []
}>()

const facts = computed(() => (props.info?.state === 'ready' ? props.info.facts : null))
const game = computed(() => props.outline.game)
const title = computed(
  () => game.value?.name ?? facts.value?.name ?? props.outline.name ?? facts.value?.address ?? props.outline.address ?? 'Здание',
)
const address = computed(() => {
  const a = facts.value?.address ?? props.outline.address
  return a && a !== title.value ? a : null
})
const description = computed(() => game.value?.description ?? null)
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

const factRows = computed(() => {
  const f = facts.value
  if (!f) return []
  const rows: { label: string; value: string }[] = []
  if (f.levels !== null) rows.push({ label: 'Этажей', value: String(f.levels) })
  if (f.built) rows.push({ label: 'Построено', value: f.built })
  if (f.series) rows.push({ label: 'Серия', value: f.series })
  if (f.flats !== null) rows.push({ label: 'Квартир', value: String(f.flats) })
  if (f.openingHours) rows.push({ label: 'Часы работы', value: f.openingHours })
  if (f.phone) rows.push({ label: 'Телефон', value: f.phone })
  return rows
})

const action = computed(() => {
  const g = game.value
  if (!g) return null
  if (g.status === 'unavailable') return { kind: 'unavailable' as const }
  if (g.status !== 'published') return null
  return g.discoveredAt ? { kind: 'discovered' as const } : { kind: 'scan' as const, id: g.id }
})

function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m / 5) * 5} м` : `${(m / 1000).toFixed(1)} км`
}
function orgCountText(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'организация' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'организации' : 'организаций'
  return `${n} ${word}`
}
</script>

<template>
  <article class="info card" :class="{ 'info--expanded': expanded }" aria-live="polite" :aria-label="title">
    <button
      type="button"
      class="info__grip"
      :aria-label="expanded ? 'Свернуть' : 'Подробнее'"
      :aria-expanded="expanded"
      @click="emit('update:expanded', !expanded)"
    />
    <button type="button" class="info__close" aria-label="Закрыть" @click="emit('close')">
      <AppIcon name="close" :size="16" />
    </button>
    <header class="info__head">
      <p class="info__kind">
        <span v-if="facts?.kind">{{ facts.kind }}</span>
        <span v-else-if="game">Игровое здание</span>
        <span v-else>Здание</span>
        <span v-if="distanceM !== null" class="info__distance">· ≈{{ distanceText(distanceM) }}</span>
      </p>
      <h2 class="info__title">{{ title }}</h2>
      <p v-if="address" class="info__address">{{ address }}</p>
    </header>

    <div v-if="info?.state === 'loading'" class="info__loading" role="status">
      <FigureLoader :size="28" /> <span>Загружаем данные…</span>
    </div>
    <p v-else-if="info?.state === 'error'" class="info__error">
      {{ info.error.code === 'offline' ? 'Нет сети.' : 'Не удалось загрузить данные.' }}
      <button type="button" class="info__link" @click="emit('retry')">Повторить</button>
    </p>

    <p v-if="description" class="info__desc" :class="{ 'info__desc--short': !expanded }">{{ description }}</p>
    <p v-if="!expanded && organizations && organizations.length" class="info__meta">
      {{ orgCountText(organizations.length) }} внутри
    </p>

    <template v-if="expanded">
      <img v-if="game?.imageUrl" :src="game.imageUrl" :alt="title" class="info__photo" loading="lazy" />

      <dl v-if="factRows.length" class="info__facts">
        <div v-for="row in factRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p v-if="facts?.website || facts?.wikidataId" class="info__links">
        <a v-if="facts?.website" :href="facts.website" target="_blank" rel="noopener noreferrer">Сайт</a>
        <a
          v-if="facts?.wikidataId"
          :href="`https://www.wikidata.org/wiki/${facts.wikidataId}`"
          target="_blank"
          rel="noopener noreferrer"
        >Викиданные</a>
      </p>

      <section class="info__orgs" aria-label="Организации в здании">
        <h3>Организации</h3>
        <p v-if="organizationsLoading" class="info__muted">Загружаем…</p>
        <ul v-else-if="organizations && organizations.length">
          <li v-for="org in organizations" :key="org.id">
            <strong>{{ org.name }}</strong>
            <span v-if="org.kind" class="info__muted"> · {{ org.kind }}</span>
            <span v-if="org.openingHours" class="info__org-line">{{ org.openingHours }}</span>
            <span v-if="org.phone" class="info__org-line">{{ org.phone }}</span>
            <a v-if="org.website" :href="org.website" target="_blank" rel="noopener noreferrer" class="info__org-line">Сайт</a>
          </li>
        </ul>
        <p v-else class="info__muted">Информация пока не добавлена</p>
      </section>

      <p v-if="!description && !factRows.length && !game?.imageUrl && info?.state === 'ready'" class="info__muted">
        Подробная информация о здании пока не добавлена
      </p>
    </template>

    <div class="info__actions">
      <AppButton v-if="!expanded" variant="secondary" @click="emit('update:expanded', true)">Подробнее</AppButton>
      <AppButton v-if="action?.kind === 'scan'" @click="emit('scan', action.id)">Открыть здание</AppButton>
      <AppButton v-else-if="action?.kind === 'discovered'" variant="secondary" @click="emit('memory')">Воспоминание</AppButton>
    </div>
    <p v-if="action?.kind === 'unavailable'" class="info__muted">Временно недоступно для сканирования</p>
    <p v-else-if="action?.kind === 'discovered'" class="info__done">Здание открыто</p>

    <p v-if="expanded" class="info__source">
      Данные: © OpenStreetMap<template v-if="game">, каталог «Метки»</template><template v-if="facts">
        · обновлено {{ dateFmt.format(new Date(facts.updatedAt)) }}</template>
    </p>
  </article>
</template>

<style scoped lang="scss">
.info {
  padding: 8px 18px calc(16px + var(--safe-bottom, 0px));
  border-radius: 24px 24px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 38vh;
  overflow-y: auto;
  transition: max-height 0.25s var(--ease);
  > * {
    flex-shrink: 0;
  }
  &--expanded {
    max-height: 80vh;
  }
}
.info {
  position: relative;
}
.info__close {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-bg);
  color: var(--c-text-2);
}
.info__head {
  padding-right: 40px;
}
.info__grip {
  align-self: center;
  width: 44px;
  height: 18px;
  padding: 0;
  border: 0;
  background: none;
  position: relative;
  &::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    top: 7px;
    height: 4px;
    border-radius: 2px;
    background: var(--c-surface-2);
  }
}
.info__kind {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-text-2);
}
.info__distance {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.info__title {
  font-size: 20px;
  font-weight: 700;
  margin-top: 2px;
}
.info__address {
  color: var(--c-text-2);
  font-size: 14px;
  margin-top: 2px;
}
.info__loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--c-accent);
  font-size: 14px;
  span {
    color: var(--c-text-2);
  }
}
.info__error {
  font-size: 14px;
  color: var(--c-danger);
}
.info__link {
  border: 0;
  padding: 0;
  background: none;
  color: var(--c-accent-strong);
  font: inherit;
  text-decoration: underline;
}
.info__desc {
  font-size: 14px;
  line-height: 1.45;
  &--short {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}
.info__meta,
.info__muted {
  font-size: 13px;
  color: var(--c-text-2);
}
.info__photo {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 16px;
}
.info__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
  dt {
    font-size: 12px;
    color: var(--c-text-2);
  }
  dd {
    margin: 2px 0 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
}
.info__links {
  display: flex;
  gap: 16px;
  font-size: 14px;
  a {
    color: var(--c-accent-strong);
  }
}
.info__orgs {
  h3 {
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    font-size: 14px;
  }
}
.info__org-line {
  display: block;
  font-size: 13px;
  color: var(--c-text-2);
}
a.info__org-line {
  color: var(--c-accent-strong);
}
.info__actions {
  display: flex;
  gap: 8px;
  > * {
    flex: 1;
  }
}
.info__done {
  color: var(--c-success);
  font-weight: 600;
  font-size: 14px;
}
.info__source {
  font-size: 11px;
  color: var(--c-text-3, var(--c-text-2));
}
</style>
