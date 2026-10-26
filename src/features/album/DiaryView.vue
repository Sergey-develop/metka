<script setup lang="ts">
import { useRouter } from 'vue-router'
import PageHero from '@/components/ui/PageHero.vue'
import DiaryBody from './DiaryBody.vue'
import { DIARY_HERO } from './diaryHero'

/**
 * «Дневник» (mockup дневник.png): the header and the diary body. Opened from the profile through the
 * diary sheet (expanded) or directly.
 */
const router = useRouter()
</script>

<template>
  <main class="page diary">
    <PageHero tone="sky" :height="DIARY_HERO.height" :row-y="DIARY_HERO.rowY" title="Дневник" @back="router.back()" />

    <div class="body">
      <DiaryBody />
    </div>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (дневник.png)
$blue: #0189ff;
$soft: #e3eefd;

.diary {
  padding: 0;
  background: #fff;
}
.body {
  // above the header it overlaps (PageHero is positioned and has its own background)
  position: relative;
  margin-top: -24px;
  // 28px on top — the height of the sheet's grip, so the content sits where the expanded diary sheet has it
  padding: 28px 16px calc(var(--nav-height) + var(--safe-bottom) + 24px);
  border-radius: 24px 24px 0 0;
  background: #fff;
}
</style>
