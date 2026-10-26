<script setup lang="ts">
import AppButton from '@/components/ui/AppButton.vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { useQuestsStore } from '@/stores/quests'
import type { QuestView } from '@/types/game'
import { useScrollLock } from '@/utils/scrollLock'
import AchievementBadge from './AchievementBadge.vue'
import { badgeKind } from './achievements'

// the page behind stays still while this is open
useScrollLock()

/** One achievement (server quest): what to do, progress, reward and the claim button. */
defineProps<{ quest: QuestView }>()
defineEmits<{ close: [] }>()

const quests = useQuestsStore()
</script>

<template>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ach-title" @keydown.esc="$emit('close')" @click.self="$emit('close')">
    <div class="sheet__body">
      <AchievementBadge class="ach__badge" :kind="badgeKind(quest)" :label="quest.title" :locked="!quest.completedAt" />
      <h2 id="ach-title" class="ach__title">{{ quest.title }}</h2>
      <p class="ach__desc">{{ quest.description }}</p>

      <div class="ach__progress">
        <ProgressBar :value="quest.progress" :max="quest.target" :label="quest.title" />
        <span>{{ Math.min(quest.progress, quest.target) }} / {{ quest.target }}</span>
      </div>

      <p class="ach__reward">
        Награда: <b>+{{ quest.reward.xp }} опыта</b> · <b class="ach__coins"><CoinIcon :size="16" />{{ quest.reward.coins }}</b>
      </p>

      <p v-if="quests.error" class="ach__error" role="alert">Не удалось получить награду. Попробуйте ещё раз.</p>
      <p v-if="quest.claimedAt" class="ach__done">Награда получена</p>
      <AppButton v-else-if="quest.completedAt" block :loading="quests.claiming.has(quest.id)" @click="quests.claim(quest.id)">
        Забрать награду
      </AppButton>
      <AppButton block variant="secondary" @click="$emit('close')">Закрыть</AppButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.sheet {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(17 19 23 / 40%);
}
// <Transition name="sheet"> in ProfileView, same motion as the settings sheet
.sheet-enter-active,
.sheet-leave-active {
  transition: background-color 0.32s var(--ease);
  .sheet__body {
    transition: transform 0.32s var(--ease);
  }
}
.sheet-leave-active {
  transition-duration: 0.24s;
  .sheet__body {
    transition: transform 0.24s cubic-bezier(0.4, 0, 1, 1);
  }
}
.sheet-enter-from,
.sheet-leave-to {
  background-color: rgb(17 19 23 / 0%);
  .sheet__body {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet__body,
  .sheet-leave-active .sheet__body {
    transition-duration: 0.01s;
  }
}
.sheet__body {
  width: 100%;
  max-width: 560px;
  max-height: 90%;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 24px 18px calc(var(--safe-bottom) + 18px);
  border-radius: 24px 24px 0 0;
  background: var(--c-surface);
  text-align: center;
}
.ach__badge {
  align-self: center;
  transform: scale(1.5);
  margin: 12px 0 16px;
}
.ach__title {
  font-size: 22px;
  font-weight: 600;
}
.ach__desc {
  font-size: 15px;
  color: var(--c-text-2);
}
.ach__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}
.ach__reward {
  font-size: 14px;
  color: var(--c-text-2);
  b {
    color: var(--c-text);
    font-weight: 600;
  }
}
.ach__coins {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  vertical-align: -3px;
}
.ach__done {
  color: var(--c-success);
  font-weight: 600;
  font-size: 15px;
}
.ach__error {
  font-size: 13px;
  color: var(--c-danger);
}
</style>
