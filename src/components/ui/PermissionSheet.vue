<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'

/** Explains why a permission is needed before the system prompt appears. */
const props = defineProps<{ kind: 'location' | 'camera' }>()
defineEmits<{ allow: []; later: [] }>()

const TEXT = {
  location: {
    icon: 'locate',
    title: 'Покажем вас на карте',
    text: 'Геолокация нужна, чтобы видеть ближайшие здания и засчитывать сканы рядом с ними. Координаты уходят на сервер только при сканировании.',
    allow: 'Разрешить геолокацию',
  },
  camera: {
    icon: 'camera',
    title: 'Нужна камера',
    text: 'Сфотографируйте фасад — по снимку приложение узнает здание. Снимок распознаётся на телефоне.',
    allow: 'Разрешить камеру',
  },
} as const

const t = TEXT[props.kind]
const allowButton = ref<InstanceType<typeof AppButton> | null>(null)
const titleId = `perm-${props.kind}-title`
onMounted(() => (allowButton.value?.$el as HTMLElement | undefined)?.focus())
</script>

<template>
  <div class="perm" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown.esc="$emit('later')">
    <div class="perm__sheet">
      <span class="perm__icon"><AppIcon :name="t.icon" :size="28" /></span>
      <h2 :id="titleId" class="perm__title">{{ t.title }}</h2>
      <p class="perm__text">{{ t.text }}</p>
      <AppButton ref="allowButton" block @click="$emit('allow')">{{ t.allow }}</AppButton>
      <AppButton block variant="ghost" @click="$emit('later')">Не сейчас</AppButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.perm {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(17 19 23 / 40%);
  animation: fade 0.2s var(--ease);
}
.perm__sheet {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 22px calc(var(--safe-bottom) + 20px);
  background: var(--c-surface);
  border-radius: 32px 32px 0 0;
  text-align: center;
  animation: rise 0.28s var(--ease);
}
.perm__icon {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-accent-soft);
  color: var(--c-accent);
}
.perm__title {
  font-size: 22px;
  font-weight: 700;
}
.perm__text {
  max-width: 340px;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--c-text-2);
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    transform: translateY(40px);
  }
}
</style>
