<script lang="ts">
/** how long the splash plays: the route draws itself, then the logo appears (App keeps it on screen this long) */
export const SPLASH_MS = 2600
</script>

<script setup lang="ts">
// mockup start.png, redrawn as SVG so it can animate: a coloured route runs in from the top-left and
// snakes down the screen; each stop (a blue circle with an icon) pops up as the route reaches it, and
// once the route has left the bottom edge the logo appears in the middle of the big curve.
// Geometry in pt of the 390pt mockup (the route is 60pt wide, stops are 60pt circles).
// the logo's wordmark alone, white (logo.png is blue and has the pin)
import wordmark from '@/assets/brand/wordmark-white.png'

type Segment = { d: string; color: string; length: number }

// path lengths are computed from the arcs below (pathLength="1" lets CSS draw them without measuring)
const SEGMENTS: Segment[] = [
  { d: 'M-10 56H171', color: '#fff68a', length: 181 },
  { d: 'M171 56H290A69 69 0 0 1 359 125', color: '#87f59a', length: 227 },
  { d: 'M359 125A69 69 0 0 1 290 194H228.5A131 131 0 0 0 127.2 242', color: '#ff8a80', length: 286 },
  { d: 'M127.2 242A131 131 0 0 0 128 409', color: '#3ca4fa', length: 181 },
  { d: 'M128 409A131 131 0 0 0 228.5 456H249', color: '#fff', length: 135 },
  { d: 'M249 456H305A54 54 0 0 1 359 510', color: '#fff68a', length: 141 },
  { d: 'M359 510A54 54 0 0 1 305 564A74 74 0 0 0 231 638V667', color: '#f8b6fb', length: 230 },
  { d: 'M231 667V740', color: '#fff', length: 73 },
]
// the route runs at an even speed
const ROUTE_MS = 1900
const TOTAL = SEGMENTS.reduce((sum, s) => sum + s.length, 0)
const timed = SEGMENTS.reduce<(Segment & { delay: number; duration: number })[]>((list, s) => {
  const prev = list[list.length - 1]
  const delay = prev ? prev.delay + prev.duration : 0
  return [...list, { ...s, delay, duration: (s.length / TOTAL) * ROUTE_MS }]
}, [])
/** when the route reaches the end of segment i */
const reach = (i: number) => {
  const s = timed[i]
  return s ? s.delay + s.duration : 0
}

// stroke icons in a 24 box, drawn white inside the circles
const STOPS = [
  {
    x: 171, y: 56, at: reach(0),
    icon: 'M3 8.5a1.5 1.5 0 0 1 1.5-1.5H8l1.5-2h5L16 7h3.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 5V7',
  },
  {
    x: 359, y: 125, at: reach(1),
    icon: 'M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 14.5 9 8h6.5l3 6.5M9 8l3.5 6.5L15.5 8M8 6h3M15.5 8l-1-2H16',
  },
  {
    x: 249, y: 456, at: reach(4),
    icon: 'M5 10h11v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-7ZM16 11.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8.8.8 1.7 0 2.5M11 3.5c-.8.8.8 1.7 0 2.5M13.5 3.5c-.8.8.8 1.7 0 2.5',
  },
  {
    x: 359, y: 510, at: reach(5),
    icon: 'M4 10.5 12 4l8 6.5M17 4.5V7M8 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4.5 21a3.5 3.5 0 0 1 7 0M12.5 21a3.5 3.5 0 0 1 7 0M8.5 20a3.5 3.5 0 0 1 7 0',
  },
  {
    x: 231, y: 667, at: reach(6),
    icon: 'M5 14v-2a7 7 0 0 1 14 0v2M5 13.5h2.5v5H6a1 1 0 0 1-1-1v-4ZM19 13.5h-2.5v5H18a1 1 0 0 0 1-1v-4ZM18 18.5c0 1.5-2 2.5-5 2.5h-1',
  },
]
const LOGO_AT = ROUTE_MS
</script>

<template>
  <div class="splash" role="status" aria-label="Загрузка «Метки»">
    <svg class="splash__art" viewBox="0 0 390 730" aria-hidden="true">
      <path
        v-for="(s, i) in timed"
        :key="i"
        class="route"
        :d="s.d"
        :stroke="s.color"
        pathLength="1"
        :style="{ animationDelay: `${s.delay}ms`, animationDuration: `${s.duration}ms` }"
      />
      <g v-for="(stop, i) in STOPS" :key="`stop${i}`" :transform="`translate(${stop.x} ${stop.y})`">
        <g class="stop" :style="{ animationDelay: `${stop.at - 60}ms` }">
          <circle r="30" fill="#0189ff" />
          <path class="stop__icon" :d="stop.icon" transform="translate(-15 -15) scale(1.25)" />
        </g>
      </g>
      <image class="logo" :href="wordmark" x="73" y="297" width="243" height="38.6" :style="{ animationDelay: `${LOGO_AT}ms` }" />
    </svg>
    <span class="visually-hidden">метка</span>
  </div>
</template>

<style scoped lang="scss">
.splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  // the mockup's sky
  background: linear-gradient(180deg, #0088fe 0%, #a1dcff 100%);
}
.splash__art {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  // full width as in the mockup, anchored to the bottom; on short screens the top is cropped
  width: 100%;
  max-width: 520px;
  height: auto;
  overflow: visible;
}

.route {
  fill: none;
  stroke-width: 60;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 1;
  animation-name: draw;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}

.stop {
  transform: scale(0);
  animation: pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.stop__icon {
  fill: none;
  stroke: #fff;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
@keyframes pop {
  to {
    transform: scale(1);
  }
}

.logo {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 0;
  transform: scale(0.9);
  animation: logo-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes logo-in {
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .route,
  .stop,
  .logo {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
  }
}
</style>
