<script setup lang="ts">
import { computed, watch } from 'vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import { useAchievementAlertsStore } from '@/stores/achievementAlerts'
import { useQuestsStore } from '@/stores/quests'
import AchievementBadge from './AchievementBadge.vue'
import { badgeKind } from './achievements'

/**
 * «Новое достижение»: shown over any page right after an achievement is completed (a scan reports it),
 * one at a time. The badge pops in, the reward can be claimed at once or later on the profile page.
 */
const alerts = useAchievementAlertsStore()
const quests = useQuestsStore()

const shown = computed(() => alerts.current)
/** the full achievement (kind, description, reward); the scan only names it */
const quest = computed(() => (shown.value ? (quests.quests.find((q) => q.id === shown.value!.questId) ?? null) : null))
const claimed = computed(() => !!quest.value?.claimedAt)
const claiming = computed(() => !!shown.value && quests.claiming.has(shown.value.questId))

// the scan made the list stale: fetch it again for the reward and the badge
watch(
  () => shown.value?.questId,
  (id) => {
    if (id && !quests.quests.some((q) => q.id === id && q.completedAt)) void quests.load(true)
  },
  { immediate: true },
)

async function claim(): Promise<void> {
  if (!shown.value) return
  await quests.claim(shown.value.questId)
  if (!quests.error) alerts.dismiss()
}
</script>

<template>
  <Transition name="unlock">
    <div v-if="shown" :key="shown.questId" class="unlock" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <div class="unlock__card">
        <div class="unlock__badge" aria-hidden="true">
          <span class="unlock__rays" />
          <AchievementBadge :kind="quest ? badgeKind(quest) : 'pin'" :locked="false" :label="shown.title" />
        </div>
        <p class="unlock__label">Новое достижение</p>
        <h2 id="unlock-title" class="unlock__title">{{ shown.title }}</h2>
        <p v-if="quest?.description" class="unlock__text">{{ quest.description }}</p>
        <p v-if="quest && (quest.reward.xp || quest.reward.coins)" class="unlock__reward">
          <span v-if="quest.reward.xp">+{{ quest.reward.xp }} опыта</span>
          <span v-if="quest.reward.coins" class="unlock__coins"><CoinIcon :size="18" />+{{ quest.reward.coins }}</span>
        </p>
        <p v-if="quests.error && !claimed" class="unlock__error" role="alert">Не удалось получить награду. Попробуйте ещё раз.</p>

        <button v-if="quest && !claimed" class="unlock__primary" :disabled="claiming" @click="claim">
          {{ claiming ? 'Получаем…' : 'Забрать награду' }}
        </button>
        <button v-else class="unlock__primary" @click="alerts.dismiss()">Отлично</button>
        <button v-if="quest && !claimed" class="unlock__later" @click="alerts.dismiss()">Позже, в профиле</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
$blue: #0189ff;

.unlock {
  position: fixed;
  inset: 0;
  z-index: 60; // over pages, sheets and the tab bar
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 20 50 / 55%);
}
.unlock__card {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 24px 20px;
  border-radius: 24px;
  background: #fff;
  text-align: center;
  box-shadow: 0 20px 60px rgb(0 30 80 / 30%);
}
.unlock__badge {
  position: relative;
  width: 120px;
  height: 120px;
  display: grid;
  place-items: center;
  :deep(.badge) {
    transform: scale(2);
    animation: badge-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
}
// a slowly turning glow behind the badge
.unlock__rays {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: repeating-conic-gradient(rgb(255 205 60 / 35%) 0deg 12deg, rgb(255 205 60 / 0%) 12deg 30deg);
  mask: radial-gradient(circle, #000 30%, transparent 70%);
  -webkit-mask: radial-gradient(circle, #000 30%, transparent 70%);
  animation: rays-spin 12s linear infinite;
}
.unlock__label {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $blue;
}
.unlock__title {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 600;
  line-height: 26px;
  color: #000;
}
.unlock__text {
  margin-top: 6px;
  font-size: 14px;
  line-height: 19px;
  color: #6d6d72;
}
.unlock__reward {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  padding: 6px 14px;
  border-radius: 10px;
  background: #eef5fd;
  font-size: 15px;
  font-weight: 500;
  color: #1f5fa8;
}
.unlock__coins {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.unlock__error {
  margin-top: 10px;
  font-size: 13px;
  color: #d93025;
}
.unlock__primary {
  width: 100%;
  height: 50px;
  margin-top: 20px;
  border: 0;
  border-radius: 12px;
  background: $blue;
  font-size: 16px;
  font-weight: 500;
  color: #fff;
  &:disabled {
    opacity: 0.6;
  }
}
.unlock__later {
  margin-top: 6px;
  padding: 8px;
  border: 0;
  background: none;
  font-size: 14px;
  color: #8e8e93;
}

.unlock-enter-active {
  transition: opacity 0.25s ease;
  .unlock__card {
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
}
.unlock-leave-active {
  transition: opacity 0.2s ease;
}
.unlock-enter-from {
  opacity: 0;
  .unlock__card {
    transform: scale(0.85) translateY(20px);
  }
}
.unlock-leave-to {
  opacity: 0;
}
@keyframes badge-pop {
  0% {
    transform: scale(0.4) rotate(-12deg);
    opacity: 0;
  }
  100% {
    transform: scale(2) rotate(0);
    opacity: 1;
  }
}
@keyframes rays-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .unlock__badge :deep(.badge),
  .unlock__rays {
    animation: none;
  }
}
</style>
