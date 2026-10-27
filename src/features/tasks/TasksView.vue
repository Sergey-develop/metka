<script setup lang="ts">
import { useRouter } from 'vue-router'
import PageHero from '@/components/ui/PageHero.vue'
import ArtifactsBlock from './ArtifactsBlock.vue'
import TasksBoard from './TasksBoard.vue'
import { TASKS_HERO } from './tasksText'

/**
 * «Задания» (mockup задания.png): the tasks board, quests, artifact collections and rarity — the same
 * content as the tasks sheet on the map expanded.
 */
const router = useRouter()
</script>

<template>
  <main class="page tv">
    <PageHero tone="blue" :height="TASKS_HERO.height" :row-y="TASKS_HERO.rowY" title="Задания" @back="router.back()" />

    <div class="tv__body">
      <TasksBoard />
      <ArtifactsBlock />
    </div>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (задания.png)
$blue: #0189ff;

.tv {
  padding: 0;
  background: $blue;
}
.tv__body {
  // above the header it overlaps (PageHero is positioned and has its own background)
  position: relative;
  min-height: calc(100vh - var(--safe-top) - 150px);
  margin-top: -32px;
  // 28px on top — the height of the sheet's grip, so «Задания дня» sits where the expanded sheet has it
  padding: 28px 16px calc(var(--nav-height) + var(--safe-bottom) + 24px);
  border-radius: 24px 24px 0 0;
  background: #fff;
}

</style>
