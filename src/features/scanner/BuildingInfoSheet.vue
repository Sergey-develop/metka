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

/** one line for the "interesting fact" strip of the compact card, built only from real OSM data */
const factLine = computed(() => {
  const f = facts.value
  if (!f) return null
  if (f.built) return `здание построено в ${f.built}${/^\d{4}$/.test(f.built) ? ' году' : ''}.`
  if (f.series) return `дом типовой серии ${f.series}.`
  if (f.levels !== null && f.levels >= 10) return `в здании ${f.levels} этажей.`
  return null
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
    <button v-if="expanded" type="button" class="info__close" aria-label="Закрыть" @click="emit('close')">
      <AppIcon name="close" :size="16" />
    </button>
    <header class="info__head">
      <p class="info__kind">
        <span class="info__tag">{{ facts?.kind ?? (game ? 'Игровое здание' : 'Здание') }}</span>
        <span v-if="distanceM !== null" class="info__distance">≈{{ distanceText(distanceM) }}</span>
      </p>
      <div class="info__row">
        <h2 class="info__title">{{ title }}</h2>
        <button
          type="button"
          class="info__more"
          :class="{ 'info__more--open': expanded }"
          :aria-label="expanded ? 'Свернуть' : 'Подробнее'"
          :aria-expanded="expanded"
          @click="emit('update:expanded', !expanded)"
        >
          <AppIcon name="chevron" :size="22" />
        </button>
      </div>
      <p v-if="address && (expanded || !description)" class="info__address">{{ address }}</p>
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
    <p v-if="!expanded && factLine" class="info__fact">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M15 2v2.5M5.5 6l1.8 1.8M24.5 6l-1.8 1.8M2.5 15H5M25 15h2.5" /></g>
        <path fill="currentColor" d="M15 8a7 7 0 0 0-4.2 12.6c.7.5 1.2 1.3 1.2 2.2V23h6v-.2c0-.9.5-1.7 1.2-2.2A7 7 0 0 0 15 8Zm-3 16.5h6v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1Z" />
      </svg>
      <span>Интересный факт: {{ factLine }}</span>
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

    <div v-if="action?.kind === 'scan' || (expanded && action?.kind === 'discovered')" class="info__actions">
      <AppButton v-if="action?.kind === 'scan'" @click="emit('scan', action.id)">Открыть здание</AppButton>
      <AppButton v-else variant="secondary" @click="emit('memory')">Воспоминание</AppButton>
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
// measured on the 390pt mockup (AR.png, 3x)
.info {
  position: relative;
  padding: 12px 12px 14px;
  border-radius: 12px;
  background: #fff;
  color: #000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 46vh;
  overflow-y: auto;
  transition: max-height 0.25s var(--ease);
  > * {
    flex-shrink: 0;
  }
  &--expanded {
    max-height: 62vh;
  }
}
.info__close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #f3f3f9;
  color: #85858c;
}
.info__kind {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  line-height: 18px;
}
.info__tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: #ff9248;
  color: #000;
}
.info__distance {
  font-size: 13px;
  color: #85858c;
}
.info--expanded .info__head {
  padding-right: 40px;
}
.info__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.info__title {
  flex: 1;
  min-width: 0;
  font-size: 24px;
  font-weight: 500;
  line-height: 28px;
}
.info__more {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: #000;
  transition: transform 0.2s var(--ease);
  &--open {
    transform: rotate(90deg);
  }
}
.info__address {
  color: #85858c;
  font-size: 14px;
  margin-top: 4px;
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
  font-size: 16px;
  line-height: 19px;
  color: #6d6d72;
  &--short {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}
.info__fact {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 12px 12px 10px;
  border-radius: 6px;
  background: #e3eefd;
  font-size: 15px;
  line-height: 19px;
  color: #85858c;
  svg {
    flex: none;
    color: #0189ff;
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
