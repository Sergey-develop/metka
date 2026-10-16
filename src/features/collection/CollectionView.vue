<script setup lang="ts">
import { onMounted } from 'vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useCollectionStore } from '@/stores/collection'
import type { Rarity } from '@/types/game'

const collection = useCollectionStore()
const FILTERS: { value: Rarity | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'common', label: 'Обычные' },
  { value: 'rare', label: 'Редкие' },
  { value: 'epic', label: 'Эпические' },
  { value: 'legendary', label: 'Легендарные' },
]
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

onMounted(() => void collection.load())
</script>

<template>
  <main class="page">
    <h1 class="page-title">Коллекция</h1>
    <div class="field search">
      <label for="q" class="visually-hidden">Поиск</label>
      <input id="q" v-model="collection.query" type="search" placeholder="Поиск" />
    </div>
    <div class="filters" role="group" aria-label="Редкость">
      <button
        v-for="f in FILTERS"
        :key="f.value"
        class="filter"
        :class="{ 'filter--on': collection.rarity === f.value }"
        :aria-pressed="collection.rarity === f.value"
        @click="collection.rarity = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <StateBlock v-if="collection.loading && !collection.loaded" kind="loading" title="Загружаем коллекцию…" />
    <StateBlock
      v-else-if="collection.error"
      kind="error"
      :title="collection.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="collection.load(true)"
    />
    <StateBlock
      v-else-if="collection.items.length === 0"
      kind="empty"
      title="Коллекция пуста"
      text="Найдите здание на карте, подойдите к нему и отсканируйте фасад."
    />
    <StateBlock v-else-if="collection.filtered.length === 0" kind="empty" title="Ничего не найдено" />
    <ul v-else class="grid">
      <li v-for="item in collection.filtered" :key="item.buildingId" class="item card">
        <div class="item__img" :class="`r-${item.rarity}`">
          <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" loading="lazy" />
          <span v-else aria-hidden="true">{{ item.name.slice(0, 1) }}</span>
        </div>
        <p class="item__name">{{ item.name }}</p>
        <p class="item__date muted">{{ dateFmt.format(new Date(item.discoveredAt)) }}</p>
      </li>
    </ul>
  </main>
</template>

<style scoped lang="scss">
.search input {
  height: 44px;
}
.filters {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 12px -16px 16px;
  padding: 0 16px;
  scrollbar-width: none;
}
.filter {
  flex: none;
  border: 0;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  background: var(--c-surface);
  font-size: 14px;
  &--on {
    background: var(--c-accent);
    color: #fff;
  }
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.item {
  padding: 10px;
}
.item__img {
  aspect-ratio: 1;
  border-radius: var(--r-md);
  background: var(--c-surface-2);
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 40px;
  font-weight: 700;
  color: var(--c-text-3);
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  &.r-rare {
    background: var(--c-accent-soft);
    color: var(--c-accent);
  }
  &.r-epic {
    background: #efe9fe;
    color: #8b5cf6;
  }
  &.r-legendary {
    background: #ffe9f7;
    color: #d6409f;
  }
}
.item__name {
  font-weight: 600;
  font-size: 14px;
  margin-top: 8px;
}
.item__date {
  font-size: 12px;
}
</style>
