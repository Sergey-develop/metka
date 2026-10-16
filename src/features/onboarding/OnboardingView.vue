<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import illustration from '@/assets/brand/onboarding.webp'
import { markOnboarded } from './onboardingState'

const slides = [
  {
    title: 'Посмотрите на Москву по-новому',
    text: 'Каждая улица, парк и сквер могут стать частью вашего следующего открытия',
  },
  {
    title: 'Сканируйте здания',
    text: 'Подойдите к зданию, сфотографируйте фасад и добавьте его в свою коллекцию',
  },
  {
    title: 'Влияйте на районы',
    text: 'Открывайте здания, выполняйте задания и вместе с кланом усиливайте влияние в округах',
  },
] as const

const router = useRouter()
const index = ref(0)
const slide = computed(() => slides[index.value] ?? slides[0])
const last = computed(() => index.value === slides.length - 1)

function next(): void {
  if (!last.value) {
    index.value++
    return
  }
  markOnboarded()
  void router.replace({ name: 'register' })
}

function skip(): void {
  markOnboarded()
  void router.replace({ name: 'login' })
}
</script>

<template>
  <main class="onboarding">
    <button class="onboarding__skip" @click="skip">Уже есть аккаунт</button>
    <div class="onboarding__art">
      <img :src="illustration" alt="Бегун с телефоном на фоне Кремля" width="844" height="840" />
    </div>

    <section class="sheet" aria-live="polite">
      <Transition name="fade" mode="out-in">
        <div :key="index" class="sheet__text">
          <h1>{{ slide.title }}</h1>
          <p>{{ slide.text }}</p>
        </div>
      </Transition>
      <div class="sheet__dots" role="tablist" aria-label="Слайды">
        <button
          v-for="(s, i) in slides"
          :key="s.title"
          class="dot"
          :class="{ 'dot--on': i === index }"
          role="tab"
          :aria-selected="i === index"
          :aria-label="`Слайд ${i + 1}`"
          @click="index = i"
        />
      </div>
      <div class="sheet__next">
        <button class="next" :aria-label="last ? 'Начать' : 'Далее'" @click="next">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12h15m-6-6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
.onboarding {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
}
.onboarding__skip {
  position: absolute;
  top: calc(var(--safe-top) + 12px);
  right: 16px;
  z-index: 2;
  border: 0;
  background: none;
  color: var(--c-text-2);
  font-size: 14px;
  padding: 8px;
}
.onboarding__art {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-top: calc(var(--safe-top) + 40px);
  img {
    width: 100%;
    max-width: 520px;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
  }
}

.sheet {
  position: relative;
  flex: none;
  margin: 24px 0 0;
  padding: 34px 28px calc(var(--safe-bottom) + 44px);
  background: var(--c-accent);
  color: #fff;
  border-radius: 44px 44px 0 0;
  text-align: center;
}
.sheet__text {
  min-height: 138px;
  h1 {
    font-size: 27px;
    font-weight: 500;
    line-height: 1.15;
    margin-bottom: 14px;
  }
  p {
    font-size: 17px;
    line-height: 1.45;
    color: rgb(255 255 255 / 75%);
  }
}
.sheet__dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 26px;
}
.dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: rgb(255 255 255 / 85%);
  transition: width 0.3s var(--ease);
  &--on {
    width: 34px;
  }
}

/* white "bite" holding the round arrow button, as in the mockup */
.sheet__next {
  position: absolute;
  right: -10px;
  bottom: calc(var(--safe-bottom) + 14px);
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: #fff;
  display: grid;
  place-items: center;
}
.next {
  width: 82px;
  height: 82px;
  border: 0;
  border-radius: 50%;
  background: var(--c-accent);
  color: #fff;
  display: grid;
  place-items: center;
  transition: transform 0.15s var(--ease);
  &:active {
    transform: scale(0.94);
  }
}
.sheet__dots {
  padding-right: 80px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
}
.fade-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
