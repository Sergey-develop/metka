<script setup lang="ts">
import FilledIcon from './FilledIcon.vue'
import type { FilledIconName } from './icons'

const tabs: { to: string; label: string; icon: FilledIconName }[] = [
  { to: '/map', label: 'Главная', icon: 'home' },
  { to: '/results', label: 'Результаты', icon: 'questsDone' },
  { to: '/collection', label: 'Коллекция', icon: 'collection' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]
</script>

<template>
  <div class="nav-wrap">
    <nav class="nav" aria-label="Основная навигация">
      <RouterLink v-for="tab in tabs" :key="tab.to" v-slot="{ href, navigate, isActive }" :to="tab.to" custom>
        <a
          :href="href"
          class="nav__item"
          :class="{ 'nav__item--active': isActive }"
          :aria-current="isActive ? 'page' : undefined"
          :aria-label="tab.label"
          @click="navigate"
        >
          <FilledIcon :name="tab.icon" :size="22" />
          <span v-if="isActive" class="nav__label">{{ tab.label }}</span>
        </a>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped lang="scss">
.nav-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  padding: 10px 10px calc(var(--safe-bottom) + 10px);
  background: var(--c-surface);
  border-radius: 32px 32px 0 0;
}

.nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid #ececf0;
  border-radius: var(--r-pill);
}

.nav__item {
  flex: 0 0 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  color: var(--c-text);
  text-decoration: none;
  transition: flex 0.28s var(--ease), background 0.2s var(--ease), color 0.2s var(--ease);

  &--active {
    flex: 1 1 auto;
    background: var(--c-accent);
    color: var(--c-accent-contrast);
  }
}

.nav__label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}
</style>
