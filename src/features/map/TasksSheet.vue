<script setup lang="ts">
import BottomSheet from '@/components/ui/BottomSheet.vue'
import PageHero from '@/components/ui/PageHero.vue'
import TasksBoard from '@/features/tasks/TasksBoard.vue'
import { TASKS_HERO } from '@/features/tasks/tasksText'

/**
 * Tasks over the map. Half open it is the mockup «выдвигаются задания»; swiped up (or by the
 * chevrons) it expands in place into the full tasks (задания.png: timer, progress bars) without opening
 * /tasks: it stops where the page's white body starts (PAGE_TOP), with the page's header behind it.
 */
const emit = defineEmits<{ close: [] }>()

/** px below the safe area where the tasks page's white body starts (TasksView: header 150px − 32px) */
const PAGE_TOP = 118
</script>

<template>
  <BottomSheet label="Задания" :top-room="PAGE_TOP" @close="emit('close')">
    <template #backdrop>
      <PageHero tone="blue" :height="TASKS_HERO.height" :row-y="TASKS_HERO.rowY" title="Задания" />
    </template>
    <template #default="{ expanded, expand }">
      <TasksBoard :sheet="!expanded" @more="expand" />
    </template>
  </BottomSheet>
</template>
