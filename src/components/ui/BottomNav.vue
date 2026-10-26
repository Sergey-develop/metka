<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import FilledIcon from './FilledIcon.vue'
import type { FilledIconName } from './icons'

type Tab = { to: string; label: string; icon: FilledIconName }

const side: [Tab, Tab, Tab, Tab] = [
  { to: '/scan', label: 'Ar', icon: 'ar' },
  { to: '/locations', label: 'Локации', icon: 'pin' },
  { to: '/events', label: 'Ивенты', icon: 'calendar' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]
const left = side.slice(0, 2)
const right = side.slice(2)
const center: Tab = { to: '/map', label: 'Карта', icon: 'map' }

// glass outline: a pill with a dome over the centre button (sampled from the mockup at 390pt)
const BUMP = 16
const PILL = 69
const width = ref(358)
const shape = computed(() => {
  const w = width.value
  const c = w / 2
  const r = PILL / 2
  const b = BUMP
  return (
    `M${r} ${b}H${c - 72}C${c - 48} ${b} ${c - 36} 0 ${c} 0C${c + 36} 0 ${c + 48} ${b} ${c + 72} ${b}` +
    `H${w - r}A${r} ${r} 0 0 1 ${w - r} ${b + PILL}H${r}A${r} ${r} 0 0 1 ${r} ${b}Z`
  )
})

// Telegram-style glass lens under the active side tab: it slides between columns,
// stretches like a drop while moving and swells while a tab is held
const route = useRoute()
const columns = [side[0], side[1], center, side[2], side[3]].map((t) => t.to)
const activeColumn = computed(() => columns.findIndex((to) => route.path.startsWith(to)))
// the map has its own round button, so the lens hides there but remembers where it was
const lensColumn = ref(Math.max(activeColumn.value, 0))
const lensVisible = computed(() => activeColumn.value >= 0 && activeColumn.value !== 2)
const pressed = ref(false)
const lens = ref<HTMLElement>()

watch(activeColumn, (next, prev) => {
  if (next < 0 || next === 2) return
  const from = lensColumn.value
  lensColumn.value = next
  if (prev === 2 || from === next || !lens.value?.animate) return
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const stretch = Math.min(1 + Math.abs(next - from) * 0.12, 1.4)
  lens.value.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: `scale(${stretch}, ${2 - stretch * 0.9})`, offset: 0.4 },
      { transform: 'scale(0.97, 1.03)', offset: 0.75 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 480, easing: 'ease-out' },
  )
})

const press = (e: PointerEvent) => {
  if ((e.target as Element | null)?.closest('.nav__item')) pressed.value = true
}
const release = () => {
  pressed.value = false
}

const root = ref<HTMLElement>()
let observer: ResizeObserver | undefined
onMounted(() => {
  const el = root.value
  if (!el) return
  width.value = el.clientWidth || width.value
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav ref="root" class="nav" aria-label="Основная навигация">
    <div class="nav__glass" :style="{ clipPath: `path('${shape}')` }" aria-hidden="true">
      <svg class="nav__outline" :viewBox="`0 0 ${width} ${BUMP + PILL}`" preserveAspectRatio="none">
        <!--
          The rim is lit like glass, not a uniform hairline (measured on the mockup):
          bright along the bottom and strongest at the bottom-right corner, bright on the upper-left arc,
          fading out mid-left, on the right slope of the dome and around the top-right corner.
          Two lights: one from the top (horizontal falloff), one from the bottom (vertical falloff).
        -->
        <defs>
          <filter id="nav-glow" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <linearGradient id="nav-top-paint" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#fff" stop-opacity="0.85" />
            <stop offset="0.12" stop-color="#fff" stop-opacity="0.7" />
            <stop offset="0.5" stop-color="#fff" stop-opacity="0.55" />
            <stop offset="0.56" stop-color="#fff" stop-opacity="0.12" />
            <stop offset="0.63" stop-color="#fff" stop-opacity="0.12" />
            <stop offset="0.7" stop-color="#fff" stop-opacity="0.55" />
            <stop offset="0.88" stop-color="#fff" stop-opacity="0.5" />
            <stop offset="0.96" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="nav-top-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.35" stop-color="#fff" />
            <stop offset="0.62" stop-color="#000" />
          </linearGradient>
          <mask id="nav-top-mask">
            <rect width="100%" height="100%" fill="url(#nav-top-fade)" />
          </mask>
          <linearGradient id="nav-bottom-paint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.4" stop-color="#fff" stop-opacity="0" />
            <stop offset="0.75" stop-color="#fff" stop-opacity="0.6" />
            <stop offset="1" stop-color="#fff" stop-opacity="0.75" />
          </linearGradient>
          <linearGradient id="nav-bottom-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#000" />
            <stop offset="0.1" stop-color="#999" />
            <stop offset="0.85" stop-color="#bbb" />
            <stop offset="0.97" stop-color="#fff" />
          </linearGradient>
          <mask id="nav-bottom-mask">
            <rect width="100%" height="100%" fill="url(#nav-bottom-fade)" />
          </mask>
        </defs>
        <g mask="url(#nav-top-mask)" stroke="url(#nav-top-paint)">
          <path class="nav__glow" :d="shape" filter="url(#nav-glow)" />
          <path class="nav__edge" :d="shape" />
        </g>
        <g mask="url(#nav-bottom-mask)" stroke="url(#nav-bottom-paint)">
          <path class="nav__glow" :d="shape" filter="url(#nav-glow)" />
          <path class="nav__edge" :d="shape" />
        </g>
      </svg>
    </div>

    <div
      class="nav__row"
      @pointerdown="press"
      @pointerup="release"
      @pointercancel="release"
      @pointerleave="release"
    >
      <div
        class="nav__track"
        :class="{ 'nav__track--hidden': !lensVisible, 'nav__track--pressed': pressed && lensVisible }"
        :style="{ '--col': lensColumn }"
        aria-hidden="true"
      >
        <div ref="lens" class="nav__lens" />
      </div>
      <template v-for="(group, gi) in [left, right]" :key="gi">
        <RouterLink v-for="tab in group" :key="tab.to" v-slot="{ href, navigate, isActive }" :to="tab.to" custom>
          <a
            :href="href"
            class="nav__item"
            :aria-current="isActive ? 'page' : undefined"
            @click="navigate"
          >
            <FilledIcon :name="tab.icon" :size="22" />
            <span class="nav__label">{{ tab.label }}</span>
          </a>
        </RouterLink>
        <RouterLink v-if="gi === 0" v-slot="{ href, navigate, isActive }" :to="center.to" custom>
          <a
            :href="href"
            class="nav__center"
            :aria-label="center.label"
            :aria-current="isActive ? 'page' : undefined"
            @click="navigate"
          >
            <FilledIcon :name="center.icon" :size="26" />
          </a>
        </RouterLink>
      </template>
    </div>
  </nav>
</template>

<style scoped lang="scss">
// no fill of its own: the page background shows through the frosted glass
.nav {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: max(calc(var(--safe-bottom) - 13px), 12px);
  z-index: 20;
  max-width: 420px;
  height: 85px; // 16 dome + 69 pill
  margin: 0 auto;
  color: #fff;
}

.nav__glass {
  position: absolute;
  inset: 0;
  // frosted glass: heavy blur of whatever is behind + a white sheen that thickens towards the bottom
  // (sampled: inside the bar the page is lifted from rgb 57 163 232 to rgb 108 185 235 at the bottom edge)
  background: linear-gradient(180deg, rgb(255 255 255 / 18%) 0%, rgb(255 255 255 / 26%) 100%);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.nav__outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;

  path {
    fill: none;
  }

  // soft light caught along the inner rim of the glass
  // stroke paint comes from the lit groups in the template
  .nav__glow {
    stroke-opacity: 0.4;
    stroke-width: 10;
  }

  .nav__edge {
    stroke-width: 2; // half of it is clipped away -> 1px inner hairline
  }
}

.nav__row {
  position: absolute;
  // inset so the lens on Ar / Профиль, which is wider than its column, keeps ~6px of glass to the bar edge
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 85px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  align-items: end;
}

.nav__track {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 20%; // one grid column
  height: 69px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transform: translateX(calc(var(--col) * 100%));
  transition:
    transform 0.5s cubic-bezier(0.34, 1.32, 0.5, 1),
    opacity 0.25s var(--ease);

  &--hidden {
    opacity: 0;
  }
}

// liquid glass pill: blurred + saturated backdrop, light rim on top, soft shade below
.nav__lens {
  // wider than its column so labels get ~12px of air left and right; ~6px of bar glass around it
  width: calc(100% + 16px);
  height: 57px;
  border-radius: 28.5px;
  background:
    radial-gradient(120% 90% at 50% 0%, rgb(255 255 255 / 34%) 0%, rgb(255 255 255 / 0%) 60%),
    rgb(255 255 255 / 20%);
  backdrop-filter: blur(6px) saturate(1.8) brightness(1.08);
  -webkit-backdrop-filter: blur(6px) saturate(1.8) brightness(1.08);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 75%),
    inset 0 -1px 2px rgb(255 255 255 / 25%),
    inset 0 0 0 0.5px rgb(255 255 255 / 40%),
    0 6px 16px rgb(0 40 90 / 14%);
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 0.25s var(--ease);

  .nav__track--pressed & {
    transform: scale(1.12, 1.08);
    background-color: rgb(255 255 255 / 28%);
  }

  .nav__track--hidden & {
    transform: scale(0.6);
  }
}

.nav__item {
  position: relative; // above the lens
  height: 69px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: inherit;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    opacity 0.2s var(--ease),
    color 0.3s var(--ease);

  &:active {
    opacity: 0.7;
  }

  &[aria-current='page'] {
    color: #0189ff;
    opacity: 1;
  }
}

.nav__label {
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  white-space: nowrap;
}

.nav__center {
  position: relative; // the lens slides underneath when jumping across the map
  align-self: center;
  justify-self: center;
  width: 62px;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(180deg, #64b0f0 0%, #47acf9 100%);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 45%),
    0 4px 14px rgb(31 143 229 / 25%);
  color: #fff;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.2s var(--ease);

  &:active {
    transform: scale(0.94);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav__track,
  .nav__lens {
    transition: opacity 0.2s linear;
  }
}
</style>
