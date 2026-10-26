<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useMemoriesStore } from '@/stores/memories'
import type { Memory } from '@/types/game'
import MemoryEditor from './MemoryEditor.vue'
import MemorySticker from './MemorySticker.vue'

const memories = useMemoriesStore()
const router = useRouter()
const editing = ref<Memory | null>(null)
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

onMounted(() => void memories.load())
</script>

<template>
  <main class="page">
    <header class="head">
      <!-- opened from the diary, the profile or the collection: back goes where the player came from -->
      <button class="back" aria-label="Назад" @click="router.back()">‹</button>
      <h1 class="page-title">Альбом</h1>
    </header>
    <div class="filters" role="group" aria-label="Фильтр">
      <button class="filter" :class="{ 'filter--on': !memories.favoritesOnly }" :aria-pressed="!memories.favoritesOnly" @click="memories.favoritesOnly = false">
        Все
      </button>
      <button class="filter" :class="{ 'filter--on': memories.favoritesOnly }" :aria-pressed="memories.favoritesOnly" @click="memories.favoritesOnly = true">
        ♥ Любимые
      </button>
    </div>

    <StateBlock v-if="memories.loading && !memories.loaded" kind="loading" title="Загружаем альбом…" />
    <StateBlock
      v-else-if="memories.error"
      kind="error"
      :title="memories.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="memories.load(true)"
    />
    <StateBlock
      v-else-if="memories.items.length === 0"
      kind="empty"
      title="Альбом пуст"
      text="Откройте здание сканированием, затем сохраните о нём воспоминание: фото, заметку и впечатление."
    />
    <StateBlock v-else-if="memories.visible.length === 0" kind="empty" title="Пока нет любимых мест" />
    <ul v-else class="list">
      <li v-for="m in memories.visible" :key="m.id">
        <button class="memory card" @click="editing = m">
          <img v-if="m.photoPath && memories.photoUrls.get(m.photoPath)" :src="memories.photoUrls.get(m.photoPath)" alt="" class="memory__photo" loading="lazy" />
          <div class="memory__body">
            <div class="memory__top">
              <p class="memory__name">{{ m.buildingName }}</p>
              <MemorySticker :impression="m.impression" :favorite="m.isFavorite" />
            </div>
            <p v-if="m.visitedOn" class="memory__date muted">{{ dateFmt.format(new Date(m.visitedOn)) }}</p>
            <p v-if="m.note" class="memory__note">{{ m.note }}</p>
          </div>
        </button>
      </li>
    </ul>

    <MemoryEditor
      v-if="editing"
      :building-id="editing.buildingId"
      :place="{ buildingName: editing.buildingName, address: editing.address, rarity: editing.rarity }"
      @close="editing = null"
    />
  </main>
</template>

<style scoped lang="scss">
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.back {
  font-size: 32px;
  line-height: 1;
  color: var(--c-text-2);
  text-decoration: none;
  padding: 0 6px;
  border: 0;
  background: none;
}
.filters {
  display: flex;
  gap: 8px;
  margin: 12px 0 16px;
}
.filter {
  padding: 6px 14px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  font-size: 14px;
  &--on {
    background: var(--c-accent);
    color: #fff;
  }
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.memory {
  width: 100%;
  padding: 0;
  border: 0;
  text-align: left;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.memory__photo {
  width: 100%;
  height: 180px;
  object-fit: cover;
}
.memory__body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.memory__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.memory__name {
  font-weight: 700;
}
.memory__date {
  font-size: 13px;
}
.memory__note {
  font-size: 14px;
  line-height: 1.4;
  white-space: pre-line;
}
</style>
