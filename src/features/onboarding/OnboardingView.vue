<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import art1 from '@/assets/brand/onboarding-1.webp'
import art2 from '@/assets/brand/onboarding-2.webp'
import art3 from '@/assets/brand/onboarding-3.webp'
import { markOnboarded } from './onboardingState'
import { MOSCOW_ENABLED } from '@/utils/gameAreas'

// texts and illustrations: mockups start-1..3.png (U+2011 — no line break at the hyphen)
const slides = [
  {
    title: MOSCOW_ENABLED ? 'Посмотрите на Москву по‑новому' : 'Посмотрите на Завидово по‑новому',
    text: 'Каждая улица, парк и сквер могут стать частью вашего следующего открытия',
    art: art1,
    alt: 'Бегун с телефоном на фоне Кремля',
  },
  {
    title: 'Наведите камеру — и узнайте больше',
    text: 'Фотографируйте локации и оставляйте виртуальные отметки.',
    art: art2,
    alt: 'Телефон снимает собор Василия Блаженного',
  },
  {
    title: 'Ваш город — ваши открытия',
    text: 'Сохраняйте понравившиеся места, собирайте собственные маршруты.',
    art: art3,
    alt: 'Девушка с путеводителем в музее',
  },
] as const

/*
 * Notch around the arrow button, traced pixel by pixel from the mockup contour
 * (origin = button centre, x = 45.25 is the sheet's right edge). It is NOT symmetric:
 * the lower lip reaches further down than the upper one, as in the design.
 * It is cut out of the sheet with a mask, so the full-screen illustration shows through. The shape
 * runs 12pt past the sheet edge so no sub-pixel sliver of blue is left along the right side.
 */
const NOTCH_PATH =
  'M57.25 -64H45.25V-57.38C45.08 -55.98 44.63 -55.11 44.2 -54.02C43.77 -52.94 43.25 -51.88 42.66 -50.87C42.08 -49.86 41.41 -48.89 40.69 -47.97C39.97 -47.05 39.18 -46.18 38.34 -45.36C37.51 -44.54 36.63 -43.75 35.7 -43.05C34.77 -42.34 33.78 -41.71 32.77 -41.12C31.76 -40.54 30.71 -40 29.64 -39.54C28.56 -39.08 27.46 -38.68 26.34 -38.35C25.22 -38.01 24.07 -37.75 22.92 -37.54C21.77 -37.34 20.6 -37.22 19.43 -37.13C18.27 -37.03 17.09 -37.06 15.92 -36.98C14.76 -36.9 13.59 -36.76 12.43 -36.64C11.26 -36.53 10.1 -36.43 8.94 -36.28C7.77 -36.13 6.62 -35.96 5.46 -35.77C4.31 -35.57 3.15 -35.36 2.01 -35.13C0.86 -34.9 -0.28 -34.65 -1.42 -34.37C-2.56 -34.1 -3.69 -33.8 -4.82 -33.47C-5.94 -33.14 -7.05 -32.77 -8.15 -32.38C-9.26 -31.99 -10.35 -31.57 -11.43 -31.12C-12.51 -30.67 -13.59 -30.2 -14.63 -29.67C-15.67 -29.14 -16.69 -28.56 -17.69 -27.95C-18.69 -27.34 -19.68 -26.7 -20.62 -26.02C-21.57 -25.33 -22.49 -24.6 -23.37 -23.83C-24.24 -23.05 -25.09 -22.23 -25.87 -21.36C-26.66 -20.5 -27.38 -19.57 -28.07 -18.62C-28.75 -17.67 -29.4 -16.69 -29.97 -15.67C-30.54 -14.65 -31.05 -13.59 -31.51 -12.52C-31.96 -11.44 -32.35 -10.33 -32.68 -9.21C-33.01 -8.09 -33.27 -6.94 -33.49 -5.79C-33.7 -4.64 -33.88 -3.48 -33.98 -2.31C-34.08 -1.15 -34.08 0.03 -34.09 1.2C-34.09 2.37 -34.1 3.54 -34.02 4.71C-33.93 5.87 -33.78 7.04 -33.58 8.19C-33.37 9.34 -33.11 10.49 -32.78 11.61C-32.45 12.73 -32.06 13.84 -31.6 14.91C-31.14 15.99 -30.62 17.04 -30.04 18.06C-29.46 19.07 -28.81 20.06 -28.12 21C-27.42 21.93 -26.66 22.84 -25.87 23.69C-25.07 24.55 -24.22 25.36 -23.34 26.12C-22.46 26.89 -21.53 27.61 -20.58 28.29C-19.63 28.98 -18.64 29.62 -17.64 30.22C-16.64 30.82 -15.61 31.38 -14.56 31.9C-13.52 32.43 -12.45 32.91 -11.37 33.37C-10.3 33.84 -9.21 34.27 -8.11 34.67C-7.02 35.08 -5.9 35.44 -4.78 35.78C-3.66 36.12 -2.53 36.44 -1.4 36.73C-0.27 37.02 0.88 37.28 2.02 37.53C3.16 37.78 4.31 38 5.47 38.21C6.62 38.43 7.77 38.63 8.93 38.81C10.08 38.98 11.25 39.13 12.41 39.26C13.57 39.38 14.74 39.47 15.91 39.58C17.07 39.7 18.24 39.82 19.4 39.93C20.57 40.03 21.74 40.05 22.9 40.23C24.05 40.41 25.2 40.69 26.32 41.01C27.44 41.34 28.56 41.72 29.63 42.17C30.71 42.63 31.76 43.17 32.77 43.75C33.78 44.34 34.76 44.98 35.69 45.69C36.62 46.4 37.51 47.17 38.35 47.99C39.18 48.8 39.99 49.66 40.71 50.58C41.43 51.5 42.08 52.49 42.66 53.5C43.25 54.51 43.77 55.57 44.2 56.65C44.63 57.73 45.08 58.61 45.25 60V64H57.25Z'
const notchMask = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="92.25" height="128" viewBox="-35 -64 92.25 128"><path d="${NOTCH_PATH}"/></svg>`,
)}")`

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
      <Transition name="fade-art">
        <img :key="index" :src="slide.art" :alt="slide.alt" width="390" height="844" />
      </Transition>
    </div>

    <section class="sheet" :style="{ '--notch': notchMask }" aria-live="polite">
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
  justify-content: flex-end;
  /* the layout was drawn on a 446pt screen; the 390pt mockup is the same layout scaled to width.
     --u is one design point at the current screen width */
  --u: calc(min(100vw, 446px) / 446);
  /* sheet height: padding 36 + text 118 + dots gap 24 + button row 55 + 37.5 above the home indicator */
  --sheet-h: calc(270.5 * var(--u) + max(var(--safe-bottom), 34px));
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
  /*
   * Full-screen illustration behind the sheet, always reaching the right and bottom screen edges.
   * In the 390×844 mockup the sheet starts at y = 578pt of the artwork (the runner's feet are just
   * above it), so that line is kept at the sheet's top edge: on shorter screens the picture moves up
   * instead of the sheet hiding the legs; on taller ones it stays pinned to the top.
   */
  --art-top: min(0px, calc(100% - var(--sheet-h) - 100vw * 578 / 390));
  position: absolute;
  inset: 0;
  img {
    position: absolute;
    top: var(--art-top);
    left: 0;
    width: 100%;
    height: calc(100% - var(--art-top));
    object-fit: cover;
    object-position: top center;
  }
}
.fade-art-enter-active,
.fade-art-leave-active {
  transition: opacity 0.3s var(--ease);
}
.fade-art-enter-from,
.fade-art-leave-to {
  opacity: 0;
}

/* Sizes in design points (--u) of the 446pt layout; at 390pt they match the onboarding mockup 1:1. */
.sheet {
  --btn: calc(55 * var(--u));
  /* gap from the button row to the sheet bottom: 37.5pt above the home-indicator zone, which the
     mockup draws as 34px; keep that space on devices/browsers without a safe-area inset too */
  --btn-bottom: calc(max(var(--safe-bottom), 34px) + 37.5 * var(--u));
  position: relative;
  isolation: isolate; // keeps the ::before fill above the illustration
  flex: none;
  /* the sheet stops short of the right screen edge, as in the mockup */
  margin: 0 calc(19 * var(--u)) 0 0;
  padding: calc(36 * var(--u)) calc(24 * var(--u)) var(--btn-bottom);
  color: #fff;
  border-radius: calc(44 * var(--u)) calc(44 * var(--u)) 0 0;
  text-align: center;

  // the blue fill lives on a layer of its own so the notch can be cut out of it without masking the button
  &::before {
    content: '';
    /*
     * The layer is 2px wider than the sheet and clipped back to the sheet's outline. The sheet's right
     * edge usually falls on a fractional pixel; if the mask box ended there, the two mask layers would
     * each half-cover that pixel column and their XOR would leave a 1px blue line through the notch.
     */
    position: absolute;
    inset: 0 -2px 0 0;
    z-index: -1;
    clip-path: inset(0 2px 0 0 round calc(44 * var(--u)) calc(44 * var(--u)) 0 0);
    background: #0189ff;
    /* button centre sits 45.25pt from the sheet's right edge (2px inside this layer); the notch is centred on it */
    --notch-size: calc(92.25 * var(--u)) calc(128 * var(--u));
    --notch-pos: right calc(2px - 12 * var(--u)) bottom calc(var(--btn-bottom) + var(--btn) / 2 - 64 * var(--u));
    -webkit-mask-image: linear-gradient(#000, #000), var(--notch);
    -webkit-mask-size: 100% 100%, var(--notch-size);
    -webkit-mask-position: 0 0, var(--notch-pos);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-composite: xor;
    mask-image: linear-gradient(#000, #000), var(--notch);
    mask-size: 100% 100%, var(--notch-size);
    mask-position: 0 0, var(--notch-pos);
    mask-repeat: no-repeat;
    mask-composite: exclude;
  }
}
.sheet__text {
  /* fixed width keeps the line breaks of the mockup */
  max-width: calc(312 * var(--u));
  min-height: calc(118 * var(--u));
  margin: 0 auto;
  h1 {
    font-size: calc(24 * var(--u));
    font-weight: 600;
    line-height: calc(25.5 * var(--u));
    letter-spacing: -0.02em;
    margin-bottom: calc(19 * var(--u));
  }
  p {
    font-size: calc(16.5 * var(--u));
    line-height: calc(24 * var(--u));
    letter-spacing: -0.03em;
    color: rgb(255 255 255 / 70%);
  }
}
.sheet__dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(10 * var(--u));
  height: var(--btn);
  margin-top: calc(24 * var(--u));
}
.dot {
  width: calc(4.5 * var(--u));
  height: calc(4.5 * var(--u));
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: #fff;
  transition: width 0.3s var(--ease);
  &--on {
    width: calc(34 * var(--u));
  }
}

.next {
  position: absolute;
  right: calc(45.25 * var(--u) - var(--btn) / 2);
  bottom: var(--btn-bottom);
  width: var(--btn);
  height: var(--btn);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f8b7fd;
  color: #fff;
  display: grid;
  place-items: center;
  transition: transform 0.15s var(--ease);
  svg {
    width: calc(28 * var(--u));
    height: calc(28 * var(--u));
  }
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
