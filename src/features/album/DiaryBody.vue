<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import bookArt from '@/assets/diary/book.webp'
import capsuleArt from '@/assets/diary/capsule.webp'
import cityArt from '@/assets/diary/city.webp'
import { useCollectionStore } from '@/stores/collection'
import { useMemoriesStore } from '@/stores/memories'
import type { CollectionItem, Memory } from '@/types/game'
import { plural } from '@/utils/plural'
import MemoryEditor from './MemoryEditor.vue'
import { MOSCOW_ENABLED } from '@/utils/gameAreas'

/**
 * The diary below its header (mockup дневник.png) — shared by the diary page and the diary sheet
 * on the profile, so the expanded sheet already looks like the page. Entries are memories (one per
 * unlocked building): «Новая запись» picks an unlocked building without one, «Смотреть записи» opens
 * the album. «Капсула времени» and «Книга года» have no backend yet and are shown as «скоро».
 */
const memories = useMemoriesStore()
const collection = useCollectionStore()

const TZ = 'Europe/Moscow'
const DAY_MS = 86_400_000
const RECENT = 8

const count = computed(() => memories.items.length)
/** days since the first entry, the first day included */
const days = computed(() => {
  if (count.value === 0) return 0
  const first = Math.min(...memories.items.map((m) => Date.parse(m.createdAt)))
  const day = (t: number) => Date.parse(new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }))
  return Math.round((day(Date.now()) - day(first)) / DAY_MS) + 1
})
const recent = computed(() => [...memories.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, RECENT))

const when = (m: Memory) => {
  const d = new Date(m.createdAt)
  return `${d.toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '')} ${d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`
}
const itemOf = (buildingId: string) => collection.items.find((i) => i.buildingId === buildingId) ?? null
/** the memory's own photo, else the scan photo / catalog image of the building */
function photo(m: Memory): string | null {
  const item = itemOf(m.buildingId)
  return memories.photoOf(m.buildingId) ?? (item ? collection.imageOf(item) : null)
}

// «Новая запись»: unlocked buildings that have no memory yet
const picking = ref(false)
const candidates = computed(() => collection.items.filter((i) => !memories.byBuilding.has(i.buildingId)))
const editing = ref<{ buildingId: string; place: { buildingName: string; address: string | null; rarity: Memory['rarity'] }; fallback: string | null } | null>(
  null,
)

function write(item: CollectionItem): void {
  picking.value = false
  editing.value = { buildingId: item.buildingId, place: { buildingName: item.name, address: null, rarity: item.rarity }, fallback: collection.imageOf(item) }
}
function open(m: Memory): void {
  editing.value = { buildingId: m.buildingId, place: { buildingName: m.buildingName, address: m.address, rarity: m.rarity }, fallback: photo(m) }
}

onMounted(() => {
  void memories.load()
  void collection.load()
})
</script>

<template>
  <div>
    <StateBlock v-if="memories.loading && !memories.loaded" kind="loading" />
    <StateBlock
      v-else-if="memories.error && !memories.loaded"
      kind="error"
      :title="memories.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить дневник'"
      action-label="Повторить"
      @action="memories.load(true)"
    />

    <template v-else>
      <div class="stats">
        <div class="stat">
          <b>{{ count }} {{ plural(count, ['запись', 'записи', 'записей']) }}</b>
          <small>В дневнике</small>
        </div>
        <div class="stat">
          <b>{{ days }} {{ plural(days, ['день', 'дня', 'дней']) }}</b>
          <small>Ведётся дневник</small>
        </div>
      </div>
      <AppButton block class="new" @click="picking = true">Новая запись</AppButton>

      <section class="city">
        <span class="city__chip"><FilledIcon name="pin" :size="16" />{{ MOSCOW_ENABLED ? 'Москва' : 'Завидово' }}</span>
        <img class="city__art" :src="cityArt" alt="" />
        <p class="city__lead">Фото и заметки</p>
        <h2 class="city__title">Дневник<br />города</h2>
        <p class="city__text">Сохраняйте моменты, делитесь историями, оставляйте следы в любимых местах</p>
        <RouterLink v-slot="{ navigate }" to="/album" custom>
          <AppButton block class="city__btn" @click="navigate">Смотреть записи</AppButton>
        </RouterLink>
      </section>

      <section class="recent">
        <div class="recent__head">
          <h2>Мои последние записки</h2>
          <RouterLink to="/album" class="more" aria-label="Все записи"><AppIcon name="chevron" :size="18" /></RouterLink>
        </div>
        <p v-if="recent.length === 0" class="recent__empty">
          Здесь появятся ваши записи. Откройте здание сканированием и сохраните о нём фото и заметку.
        </p>
        <div v-else class="strip">
          <button v-for="m in recent" :key="m.id" class="note" @click="open(m)">
            <span class="note__photo">
              <img v-if="photo(m)" :src="photo(m)!" alt="" loading="lazy" />
              <span v-if="m.note" class="note__quote">“ {{ m.note }}</span>
            </span>
            <span class="note__place"><FilledIcon name="pin" :size="18" />{{ m.buildingName }}</span>
            <span class="note__date">{{ when(m) }}</span>
          </button>
        </div>
      </section>

      <section class="soon soon--capsule">
        <div class="soon__text">
          <h3>Капсула времени</h3>
          <p>Оставьте послание себе или другу. Откроется через год или при встрече.</p>
        </div>
        <span class="soon__badge">Скоро</span>
        <img class="soon__art soon__art--capsule" :src="capsuleArt" alt="" />
      </section>
      <section class="soon soon--book">
        <img class="soon__art soon__art--book" :src="bookArt" alt="" />
        <div class="soon__text">
          <h3>Книга года</h3>
          <p>Все ваши фото и заметки за год в красивой книге.</p>
        </div>
        <span class="soon__badge">Скоро</span>
      </section>
    </template>

    <!-- out to <body>: inside the diary sheet (moved by transform) a fixed sheet would be clipped to its
         panel (the dimming missed its corners) and its touches would drag the diary under it -->
    <Teleport to="body">
      <Transition name="sheet">
        <BottomSheet v-if="picking" label="Новая запись" @close="picking = false">
          <h2 class="pick__title">О каком месте запись?</h2>
          <StateBlock v-if="collection.loading && !collection.loaded" kind="loading" />
          <p v-else-if="candidates.length === 0" class="pick__empty">
            {{ collection.items.length ? 'О всех открытых местах уже есть записи. Откройте новое здание сканированием.' : 'Записи ведутся об открытых местах. Откройте здание сканированием.' }}
          </p>
          <ul v-else class="pick">
            <li v-for="item in candidates" :key="item.buildingId">
              <button class="pick__row" @click="write(item)">
                <img v-if="collection.imageOf(item)" :src="collection.imageOf(item)!" alt="" />
                <span v-else class="pick__ph" />
                <span>{{ item.name }}</span>
                <AppIcon name="chevron" :size="18" />
              </button>
            </li>
          </ul>
        </BottomSheet>
      </Transition>
    </Teleport>

    <MemoryEditor
      v-if="editing"
      :building-id="editing.buildingId"
      :place="editing.place"
      :fallback-photo="editing.fallback"
      @close="editing = null"
    />
  </div>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (дневник.png)
$blue: #0189ff;
$soft: #e3eefd;

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border-radius: 8px;
  background: $soft;
  b {
    font-size: 20px;
    font-weight: 600;
    color: $blue;
  }
  small {
    font-size: 12px;
    color: #495057;
  }
}
.new {
  margin-top: 8px;
}

.city {
  position: relative;
  margin-top: 28px;
  padding: 16px 14px 12px;
  border-radius: 10px;
  overflow: hidden;
  // the art was cut on this colour
  background: $soft;
}
.city__chip {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 8px;
  background: $blue;
  color: #fff;
  font-size: 14px;
}
.city__art {
  position: absolute;
  right: 0;
  bottom: 52px;
  width: 52%;
  pointer-events: none;
}
.city__lead,
.city__title,
.city__text {
  position: relative;
  max-width: 60%;
}
.city__lead {
  font-size: 13px;
  color: #000;
}
.city__title {
  margin-top: 4px;
  font-size: 30px;
  font-weight: 700;
  line-height: 32px;
  color: #000;
}
.city__text {
  margin-top: 16px;
  font-size: 12px;
  line-height: 15px;
  color: #495057;
}
.city__btn {
  position: relative;
  margin-top: 24px;
}

.recent {
  margin-top: 32px;
}
.recent__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  h2 {
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
  border-radius: 50%;
  background: #f3f3f9;
  color: #000;
}
.recent__empty {
  font-size: 14px;
  color: #6d6d6e;
}
.strip {
  display: flex;
  gap: 8px;
  margin-right: -16px;
  padding-right: 16px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.note {
  flex: 0 0 158px;
  display: flex;
  flex-direction: column;
  padding: 0 0 8px;
  border: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #f3f3f9;
  text-align: left;
  color: inherit;
}
.note__photo {
  position: relative;
  height: 138px;
  background: #d5d1d1;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.note__quote {
  position: absolute;
  inset: 0 0 auto;
  display: -webkit-box;
  padding: 8px 8px 16px;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  background: linear-gradient(180deg, rgb(0 0 0 / 45%), rgb(0 0 0 / 0%));
  font-size: 9px;
  line-height: 11px;
  color: #fff;
}
.note__place {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #000;
}
.note__date {
  margin: 2px 8px 0;
  font-size: 11px;
  color: #8e8e93;
}

.soon {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 14px;
  border-radius: 10px;
  overflow: hidden;
  h3 {
    font-size: 15px;
    font-weight: 600;
    color: #000;
  }
  p {
    margin-top: 6px;
    font-size: 12px;
    line-height: 15px;
    color: #6d6d6e;
  }
}
.soon--capsule {
  margin-top: 32px;
  // the art was cut on this colour
  background: $soft;
}
.soon--book {
  background: #f3f3f9;
}
.soon__text {
  position: relative;
  z-index: 1; // above the capsule art
  flex: 1;
  min-width: 0;
  // room for the «Скоро» pill in the top-right corner
  padding-right: 64px;
}
// the capsule's envelope sits bottom-right: the text wraps before it
.soon--capsule .soon__text {
  padding-right: 96px;
}
// «Скоро»: a small pill pinned to the top-right corner, above the art
.soon__badge {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 9px;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #0189ff;
}
.soon__art--capsule {
  position: absolute;
  z-index: 0;
  right: 6px;
  bottom: 0;
  width: 112px;
  opacity: 0.9;
  pointer-events: none;
}
.soon__art--book {
  flex: none;
  width: 66px;
}

.pick__title {
  margin: 4px 0 12px;
  font-size: 18px;
  font-weight: 600;
}
.pick__empty {
  font-size: 14px;
  color: #6d6d6e;
}
.pick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pick__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: #f8f8fe;
  text-align: left;
  font-size: 15px;
  color: #000;
  img,
  .pick__ph {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    object-fit: cover;
    background: #d5d1d1;
  }
  span:not(.pick__ph) {
    flex: 1;
  }
}
</style>
