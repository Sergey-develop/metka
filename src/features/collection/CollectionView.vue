<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { services } from '@/app/providers/services'
import { toApiError, type ApiError } from '@/services/api/errors'
import type { LandmarkCollection } from '@/types/game'
import skyscrapersArt from '@/assets/landmarks/skyscrapers.webp'
import oldTreesArt from '@/assets/landmarks/old-trees.webp'
import monumentsArt from '@/assets/landmarks/monuments.webp'
import metroArt from '@/assets/landmarks/metro.webp'

/**
 * «Коллекция и артефакты» (mockup «Коллекция и артефакты.jpg»): curated collections of places
 * (migration 023) with the places the player has marked.
 */
const router = useRouter()

/** photos are cut from the mockup */
const ART: Record<string, string> = {
  skyscrapers: skyscrapersArt,
  old_trees: oldTreesArt,
  monuments: monumentsArt,
  metro: metroArt,
}

const collections = ref<LandmarkCollection[] | null>(null)
const error = ref<ApiError | null>(null)

async function load(): Promise<void> {
  error.value = null
  try {
    collections.value = await services().api.getLandmarkCollections()
  } catch (e) {
    error.value = toApiError(e)
  }
}

const markedCount = (c: LandmarkCollection) => c.items.filter((i) => i.marked).length
const ratio = (c: LandmarkCollection) => `${c.items.length > 0 ? (markedCount(c) / c.items.length) * 100 : 0}%`

onMounted(() => void load())
</script>

<template>
  <main class="page cv">
    <header class="cv__head">
      <button class="cv__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1>Коллекция и артефакты</h1>
    </header>

    <StateBlock
      v-if="error"
      kind="error"
      :title="error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="load"
    />
    <StateBlock v-else-if="!collections" kind="loading" title="Загружаем коллекции…" />
    <ul v-else class="cv__list">
      <li v-for="c in collections" :key="c.id" class="lc">
        <img v-if="ART[c.id]" class="lc__art" :src="ART[c.id]" alt="" />
        <div class="lc__head">
          <h2>{{ c.title }}</h2>
          <span class="lc__count">{{ markedCount(c) }}/{{ c.items.length }}</span>
        </div>
        <span class="lc__bar" role="progressbar" :aria-valuenow="markedCount(c)" :aria-valuemax="c.items.length" :aria-label="c.title">
          <span :style="{ width: ratio(c) }" />
        </span>
        <ul class="lc__items">
          <li v-for="item in c.items" :key="item.id" class="lc__item" :class="{ 'lc__item--on': item.marked }">
            <span class="lc__check" aria-hidden="true"><AppIcon v-if="item.marked" name="check" :size="14" /></span>
            <span>{{ item.name }}</span>
            <span class="visually-hidden">{{ item.marked ? '— отмечено' : '' }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup («Коллекция и артефакты.jpg»)
$blue: #0189ff;

.cv {
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.cv__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  margin: 8px 0 24px;
  h1 {
    font-size: 17px;
    font-weight: 600;
    color: #000;
  }
}
.cv__back {
  position: absolute;
  left: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #eeeef0;
  color: #000;
}

.cv__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lc {
  padding: 8px 8px 16px;
  border-radius: 8px;
  background: #f8f8fe;
}
.lc__art {
  display: block;
  width: 100%;
  aspect-ratio: 342 / 160;
  border-radius: 6px;
  object-fit: cover;
}
.lc__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 18px 4px 0;
  h2 {
    font-size: 14px;
    font-weight: 600;
    color: #000;
  }
}
.lc__count {
  flex: none;
  font-size: 12px;
  color: #8e8e93;
}
.lc__bar {
  display: block;
  height: 6px;
  margin: 12px 4px 0;
  border-radius: 3px;
  background: #e3eefd;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: $blue;
    transition: width 0.3s ease;
  }
}
.lc__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 4px 0;
  padding: 0;
  list-style: none;
}
.lc__item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #000;
}
.lc__check {
  flex: none;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border: 1px solid #d1d1d6;
  border-radius: 50%;
  color: #fff;
}
.lc__item--on .lc__check {
  border-color: $blue;
  background: $blue;
}
</style>
