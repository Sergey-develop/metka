<script setup lang="ts">
import coinIcon from '@/assets/icons/wallet-coin.png'
import fireIcon from '@/assets/icons/wallet-fire.png'
import { daysText } from '@/utils/plural'

/**
 * Coins and the streak of active days (profile and the map's header). `coins` null hides the coins
 * (someone else's profile). The parent gives the tile its background.
 */
defineProps<{ coins: number | null; streak: number | null | undefined }>()
</script>

<template>
  <span class="wallet">
    <span v-if="coins !== null" class="wallet__coins" :aria-label="`${coins} монет`">
      <img class="wallet__icon" :src="coinIcon" alt="" width="22" height="20" />
      {{ coins.toLocaleString('ru-RU') }}
    </span>
    <span class="wallet__streak">
      <img class="wallet__icon" :src="fireIcon" alt="" width="17" height="20" />
      {{ daysText(streak) }}
    </span>
  </span>
</template>

<style scoped lang="scss">
.wallet {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: auto;
  align-items: center;
  height: 40px;
  padding: 4px;
  border-radius: 10px;
}
.wallet__coins,
.wallet__streak {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.wallet__icon {
  flex: none;
  object-fit: contain;
}
.wallet__coins {
  border-radius: 8px;
  background: #e1effc;
  color: #309cef;
}
.wallet__streak {
  color: #fd8702;
}
</style>
