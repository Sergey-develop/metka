<script setup lang="ts">
import { onMounted } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useQuestsStore } from '@/stores/quests'

const quests = useQuestsStore()
onMounted(() => void quests.load())
</script>

<template>
  <main class="page">
    <h1 class="page-title">Задания</h1>
    <StateBlock v-if="quests.loading && !quests.loaded" kind="loading" title="Загружаем задания…" />
    <StateBlock
      v-else-if="quests.error && !quests.loaded"
      kind="error"
      title="Не удалось загрузить задания"
      action-label="Повторить"
      @action="quests.load(true)"
    />
    <StateBlock v-else-if="quests.quests.length === 0" kind="empty" title="Сейчас нет активных заданий" />
    <template v-else>
      <p v-if="quests.error" class="notice notice--error">Не удалось получить награду. Попробуйте ещё раз.</p>
      <ul class="list">
        <li v-for="q in quests.quests" :key="q.id" class="quest card">
          <div class="quest__head">
            <h2>{{ q.title }}</h2>
            <span class="quest__reward">+{{ q.reward.xp }} XP · {{ q.reward.coins }} ◎</span>
          </div>
          <p class="muted quest__desc">{{ q.description }}</p>
          <div class="quest__progress">
            <ProgressBar :value="q.progress" :max="q.target" :label="q.title" />
            <span>{{ q.progress }} / {{ q.target }}</span>
          </div>
          <p v-if="q.claimedAt" class="quest__done">Награда получена</p>
          <AppButton v-else-if="q.completedAt" block :loading="quests.claiming.has(q.id)" @click="quests.claim(q.id)">
            Забрать награду
          </AppButton>
        </li>
      </ul>
    </template>
  </main>
</template>

<style scoped lang="scss">
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.quest {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quest__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  h2 {
    font-size: 17px;
    font-weight: 700;
  }
}
.quest__reward {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-accent);
}
.quest__desc {
  font-size: 14px;
}
.quest__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
}
.quest__done {
  color: var(--c-success);
  font-weight: 600;
  font-size: 14px;
}
</style>
