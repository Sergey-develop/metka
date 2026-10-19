<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import illustration from '@/assets/brand/onboarding.webp'
import { markOnboarded } from './onboardingState'

const slides = [
  {
    title: 'Посмотрите на Москву по‑новому', // U+2011: no line break at the hyphen
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
      <!--
        White notch around the arrow button, traced pixel by pixel from the mockup contour
        (origin = button centre, x = 45.25 is the sheet's right edge). It is NOT symmetric:
        the lower lip reaches further down than the upper one, as in the design.
      -->
      <svg class="sheet__notch" width="80.25" height="128" viewBox="-35 -64 80.25 128" aria-hidden="true">
        <path
          d="M45.25 -64V-57.38C45.08 -55.98 44.63 -55.11 44.2 -54.02C43.77 -52.94 43.25 -51.88 42.66 -50.87C42.08 -49.86 41.41 -48.89 40.69 -47.97C39.97 -47.05 39.18 -46.18 38.34 -45.36C37.51 -44.54 36.63 -43.75 35.7 -43.05C34.77 -42.34 33.78 -41.71 32.77 -41.12C31.76 -40.54 30.71 -40 29.64 -39.54C28.56 -39.08 27.46 -38.68 26.34 -38.35C25.22 -38.01 24.07 -37.75 22.92 -37.54C21.77 -37.34 20.6 -37.22 19.43 -37.13C18.27 -37.03 17.09 -37.06 15.92 -36.98C14.76 -36.9 13.59 -36.76 12.43 -36.64C11.26 -36.53 10.1 -36.43 8.94 -36.28C7.77 -36.13 6.62 -35.96 5.46 -35.77C4.31 -35.57 3.15 -35.36 2.01 -35.13C0.86 -34.9 -0.28 -34.65 -1.42 -34.37C-2.56 -34.1 -3.69 -33.8 -4.82 -33.47C-5.94 -33.14 -7.05 -32.77 -8.15 -32.38C-9.26 -31.99 -10.35 -31.57 -11.43 -31.12C-12.51 -30.67 -13.59 -30.2 -14.63 -29.67C-15.67 -29.14 -16.69 -28.56 -17.69 -27.95C-18.69 -27.34 -19.68 -26.7 -20.62 -26.02C-21.57 -25.33 -22.49 -24.6 -23.37 -23.83C-24.24 -23.05 -25.09 -22.23 -25.87 -21.36C-26.66 -20.5 -27.38 -19.57 -28.07 -18.62C-28.75 -17.67 -29.4 -16.69 -29.97 -15.67C-30.54 -14.65 -31.05 -13.59 -31.51 -12.52C-31.96 -11.44 -32.35 -10.33 -32.68 -9.21C-33.01 -8.09 -33.27 -6.94 -33.49 -5.79C-33.7 -4.64 -33.88 -3.48 -33.98 -2.31C-34.08 -1.15 -34.08 0.03 -34.09 1.2C-34.09 2.37 -34.1 3.54 -34.02 4.71C-33.93 5.87 -33.78 7.04 -33.58 8.19C-33.37 9.34 -33.11 10.49 -32.78 11.61C-32.45 12.73 -32.06 13.84 -31.6 14.91C-31.14 15.99 -30.62 17.04 -30.04 18.06C-29.46 19.07 -28.81 20.06 -28.12 21C-27.42 21.93 -26.66 22.84 -25.87 23.69C-25.07 24.55 -24.22 25.36 -23.34 26.12C-22.46 26.89 -21.53 27.61 -20.58 28.29C-19.63 28.98 -18.64 29.62 -17.64 30.22C-16.64 30.82 -15.61 31.38 -14.56 31.9C-13.52 32.43 -12.45 32.91 -11.37 33.37C-10.3 33.84 -9.21 34.27 -8.11 34.67C-7.02 35.08 -5.9 35.44 -4.78 35.78C-3.66 36.12 -2.53 36.44 -1.4 36.73C-0.27 37.02 0.88 37.28 2.02 37.53C3.16 37.78 4.31 38 5.47 38.21C6.62 38.43 7.77 38.63 8.93 38.81C10.08 38.98 11.25 39.13 12.41 39.26C13.57 39.38 14.74 39.47 15.91 39.58C17.07 39.7 18.24 39.82 19.4 39.93C20.57 40.03 21.74 40.05 22.9 40.23C24.05 40.41 25.2 40.69 26.32 41.01C27.44 41.34 28.56 41.72 29.63 42.17C30.71 42.63 31.76 43.17 32.77 43.75C33.78 44.34 34.76 44.98 35.69 45.69C36.62 46.4 37.51 47.17 38.35 47.99C39.18 48.8 39.99 49.66 40.71 50.58C41.43 51.5 42.08 52.49 42.66 53.5C43.25 54.51 43.77 55.57 44.2 56.65C44.63 57.73 45.08 58.61 45.25 60V64Z"
        />
      </svg>
      <button class="next" :aria-label="last ? 'Начать' : 'Далее'" @click="next">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4.93 12h14.14m-4.29-4.29 4.29 4.29-4.29 4.29" />
        </svg>
      </button>
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

/* Sizes follow the mockup (start (1).png, 2x export of a 446pt-wide screen). */
.sheet {
  --btn: 55px;
  /* gap from the button row to the sheet bottom: 37.5px above the home-indicator zone, which the
     mockup draws as 34px; keep that space on devices/browsers without a safe-area inset too */
  --btn-bottom: calc(max(var(--safe-bottom), 34px) + 37.5px);
  position: relative;
  flex: none;
  /* the sheet stops short of the right screen edge, as in the mockup */
  margin: 24px 19px 0 0;
  padding: 36px 24px var(--btn-bottom);
  background: var(--c-accent);
  color: #fff;
  border-radius: 44px 44px 0 0;
  text-align: center;
}
.sheet__text {
  /* fixed width keeps the line breaks of the mockup */
  max-width: 312px;
  min-height: 118px;
  margin: 0 auto;
  h1 {
    font-size: 24px;
    font-weight: 400;
    line-height: 25.5px;
    letter-spacing: -0.02em;
    margin-bottom: 19px;
  }
  p {
    font-size: 16.5px;
    line-height: 24px;
    letter-spacing: -0.03em;
    color: rgb(255 255 255 / 70%);
  }
}
.sheet__dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: var(--btn);
  margin-top: 24px;
}
.dot {
  width: 4.5px;
  height: 4.5px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: #fff;
  transition: width 0.3s var(--ease);
  &--on {
    width: 34px;
  }
}

/* button centre sits 45.25px from the sheet's right edge; the notch svg is centred on it */
.sheet__notch {
  position: absolute;
  right: 0;
  bottom: calc(var(--btn-bottom) + var(--btn) / 2 - 64px);
  fill: #fff;
  pointer-events: none;
}
.next {
  position: absolute;
  right: calc(45.25px - var(--btn) / 2);
  bottom: var(--btn-bottom);
  width: var(--btn);
  height: var(--btn);
  padding: 0;
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
