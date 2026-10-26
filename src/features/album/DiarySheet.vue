<script setup lang="ts">
import BottomSheet from '@/components/ui/BottomSheet.vue'
import PageHero from '@/components/ui/PageHero.vue'
import DiaryBody from './DiaryBody.vue'
import { DIARY_HERO } from './diaryHero'

/**
 * The diary over the profile, like the clan and tasks sheets on the map. Half open it shows the top of
 * the diary (DiaryBody, the same as the page); swiped up it expands in place to the whole diary, without
 * opening /diary (a page swap left it unscrollable for a moment). It stops where the page's white body
 * starts (PAGE_TOP), with the page's header behind it, so it looks like the page.
 */
const emit = defineEmits<{ close: [] }>()

/** px below the safe area where the diary page's white body starts (DiaryView: header 170px − 24px) */
const PAGE_TOP = 146
</script>

<template>
  <BottomSheet label="Дневник" :top-room="PAGE_TOP" @close="emit('close')">
    <template #backdrop>
      <PageHero tone="sky" :height="DIARY_HERO.height" :row-y="DIARY_HERO.rowY" title="Дневник" />
    </template>
    <DiaryBody />
  </BottomSheet>
</template>
