<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { services } from '@/app/providers/services'
import { toApiError, type ApiError } from '@/services/api/errors'
import type { Rarity, StyleCollections } from '@/types/game'
import rareBadge from '@/assets/collections/rare.webp'
import epicBadge from '@/assets/collections/epic.webp'
import legendaryBadge from '@/assets/collections/legendary.webp'
import { COLLECTION_INFO } from './tasksText'

/**
 * «Коллекции по стилям» and «Редкость артефактов» (mockup задания.png) — on the tasks page and in the
 * expanded tasks sheet. Collections come from style_collections (migration 021): OSM buildings of a
 * style the player walked past. «Парки» from the mockup has no data yet.
 */
const styles = ref<StyleCollections | null>(null)
const stylesError = ref<ApiError | null>(null)

async function loadStyles(): Promise<void> {
  stylesError.value = null
  try {
    styles.value = await services().api.getStyleCollections()
  } catch (e) {
    stylesError.value = toApiError(e)
  }
}

const RARITY_INFO: Record<Exclude<Rarity, 'common'>, { title: string; badge: string }> = {
  rare: { title: 'Редкий', badge: rareBadge },
  epic: { title: 'Эпический', badge: epicBadge },
  legendary: { title: 'Легендарный', badge: legendaryBadge },
}
const ratio = (n: number, total: number) => `${total > 0 ? Math.min(1, n / total) * 100 : 0}%`

onMounted(() => void loadStyles())
</script>

<template>
  <div>
    <section class="block">
      <h2>Коллекции по стилям</h2>
      <p v-if="stylesError" class="block__note">
        Не удалось загрузить коллекции.
        <button class="link" @click="loadStyles">Повторить</button>
      </p>
      <ul v-else-if="styles" class="styles">
        <li v-for="c in styles.collections" :key="c.id" class="style">
          <img class="style__art" :src="COLLECTION_INFO[c.id].art" alt="" />
          <h3 class="style__title">{{ COLLECTION_INFO[c.id].title }}</h3>
          <p class="style__count">{{ c.collected }}/{{ c.total }}</p>
          <span class="bar" role="progressbar" :aria-valuenow="c.collected" :aria-valuemax="c.total" :aria-label="COLLECTION_INFO[c.id].title">
            <span :style="{ width: ratio(c.collected, c.total) }" />
          </span>
        </li>
      </ul>
      <p class="block__note">Здание попадает в коллекцию, когда вы проходите рядом с ним.</p>
    </section>

    <section v-if="styles" class="block">
      <h2>Редкость артефактов</h2>
      <ul class="rarity">
        <li v-for="r in styles.rarity" :key="r.rarity" class="rarity__row" :class="{ 'rarity__row--none': r.found === 0 }">
          <img class="rarity__badge" :src="RARITY_INFO[r.rarity].badge" alt="" />
          <span class="rarity__text">
            <b>{{ RARITY_INFO[r.rarity].title }}</b>
            <small>Найдено {{ r.found }} из {{ r.total }}</small>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
$blue: #0189ff;

.block {
  margin-top: 36px;
  h2 {
    margin-bottom: 14px;
    font-size: 22px;
    font-weight: 600;
    color: #000;
  }
}
.block__note {
  margin-top: 8px;
  font-size: 12px;
  color: #8e8e93;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: $blue;
  font: inherit;
}

.styles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.style {
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
  border-radius: 8px;
  background: #f8f8fe;
}
.style__art {
  width: 100%;
  aspect-ratio: 152 / 92;
  border-radius: 6px;
  object-fit: cover;
}
.style__title {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #000;
}
.style__count {
  margin-top: 2px;
  font-size: 12px;
  color: #8e8e93;
}
.bar {
  display: block;
  height: 6px;
  margin-top: 10px;
  border-radius: 3px;
  background: #e3eefd;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: $blue;
  }
}

.rarity {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rarity__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-radius: 8px;
  // the badges were cut on this colour
  background: #f8f8fe;
}
.rarity__row--none {
  .rarity__badge {
    filter: grayscale(1);
    opacity: 0.6;
  }
  b {
    color: #8e8e93;
  }
}
.rarity__badge {
  width: 42px;
  height: 42px;
}
.rarity__text {
  display: flex;
  flex-direction: column;
  b {
    font-size: 16px;
    font-weight: 500;
    color: #000;
  }
  small {
    font-size: 13px;
    color: #6d6d6e;
  }
}
</style>
