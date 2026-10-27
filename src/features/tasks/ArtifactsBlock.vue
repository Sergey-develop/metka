<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { collectionPhoto } from '@/features/routes/photos'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import { useCollectionStore } from '@/stores/collection'
import type { Rarity } from '@/types/game'
import rareBadge from '@/assets/collections/rare.webp'
import epicBadge from '@/assets/collections/epic.webp'
import legendaryBadge from '@/assets/collections/legendary.webp'

/**
 * «Коллекция и артефакты» and «Редкость артефактов» (mockup Tasks.jpg) on the tasks page. The collections
 * are the Zavidovo artifact collections (area_quests, migration 026); a rarity is greyed out until a
 * building of it is opened (the player's collection).
 */
const quests = useAreaQuestsStore()
const collections = computed(() => quests.data?.collections ?? [])
const earned = (items: { earnedAt: string | null }[]) => items.filter((i) => i.earnedAt).length

const collection = useCollectionStore()

type Rare = Exclude<Rarity, 'common'>
const RARITIES: Rare[] = ['rare', 'epic', 'legendary']
const RARITY_INFO: Record<Rare, { title: string; note: string; badge: string }> = {
  rare: { title: 'Редкий', note: 'Только ночью, в дождь или снег', badge: rareBadge },
  epic: { title: 'Эпический', note: 'Очень редко', badge: epicBadge },
  legendary: { title: 'Легендарный', note: 'Крайне редко', badge: legendaryBadge },
}
/** greyed out until one is found; while the collection is loading nothing is greyed */
const none = (r: Rare) => collection.loaded && !collection.items.some((i) => i.rarity === r)
const ratio = (n: number, total: number) => `${total > 0 ? Math.min(1, n / total) * 100 : 0}%`

onMounted(() => {
  void quests.load()
  void collection.load()
})
</script>

<template>
  <div>
    <section v-if="collections.length" class="block">
      <header class="block__head">
        <h2>Коллекция и артефакты</h2>
        <RouterLink to="/routes" class="block__more" aria-label="Все артефакты"><AppIcon name="chevron" :size="20" /></RouterLink>
      </header>
      <ul class="styles">
        <li v-for="c in collections" :key="c.id" class="style">
          <img v-if="collectionPhoto(c.id)" class="style__art" :src="collectionPhoto(c.id)!" alt="" />
          <span v-else class="style__art" />
          <h3 class="style__title">«{{ c.title }}»</h3>
          <span class="style__row">
            <span class="bar" role="progressbar" :aria-valuenow="earned(c.items)" :aria-valuemax="c.items.length" :aria-label="c.title">
              <span :style="{ width: ratio(earned(c.items), c.items.length) }" />
            </span>
            <span class="style__count">{{ earned(c.items) }}/{{ c.items.length }}</span>
          </span>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>Редкость артефактов</h2>
      <ul class="rarity">
        <li v-for="r in RARITIES" :key="r" class="rarity__row" :class="{ 'rarity__row--none': none(r) }">
          <img class="rarity__badge" :src="RARITY_INFO[r].badge" alt="" />
          <span class="rarity__text">
            <b>{{ RARITY_INFO[r].title }}</b>
            <small>{{ RARITY_INFO[r].note }}</small>
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
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  h2 {
    margin-bottom: 0;
  }
}
.block__more {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f2f2f7;
  color: #000;
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
  display: block;
  width: 100%;
  aspect-ratio: 152 / 92;
  border-radius: 6px;
  object-fit: cover;
  background: #e3eefd;
}
.style__title {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 600;
  line-height: 17px;
  color: #000;
}
.style__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
}
.style__count {
  flex: none;
  font-size: 12px;
  color: #8e8e93;
}
.bar {
  flex: 1;
  display: block;
  height: 6px;
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
