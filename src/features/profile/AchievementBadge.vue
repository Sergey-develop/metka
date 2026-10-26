<script setup lang="ts">
import { computed } from 'vue'

/** Hexagonal achievement badge from the profile mockup; locked badges are greyed out with a padlock. */
const props = defineProps<{ kind: 'pin' | 'map' | 'compass'; locked: boolean; label: string }>()

const FILL = { pin: ['#2f7fd8', '#0f4f9e'], map: ['#2fa35a', '#0c6b37'], compass: ['#1d7fb5', '#0c4f80'] } as const
const id = `badge-${Math.random().toString(36).slice(2, 8)}`
const colors = computed(() => (props.locked ? ['#e4e8ed', '#cdd3db'] : FILL[props.kind]))

// pointy-top hexagon, r = 22 around (26, 26)
const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2
  return `${(26 + 22 * Math.cos(a)).toFixed(2)},${(26 + 22 * Math.sin(a)).toFixed(2)}`
}).join(' ')
</script>

<template>
  <span class="badge" :class="{ 'badge--locked': locked }" role="img" :aria-label="locked ? `${label} — ещё не получено` : label">
    <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
      <defs>
        <linearGradient :id="id" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="colors[0]" />
          <stop offset="1" :stop-color="colors[1]" />
        </linearGradient>
      </defs>
      <polygon class="badge__rim" :points="HEX" />
      <polygon :points="HEX" :fill="`url(#${id})`" />

      <g v-if="kind === 'pin'" class="badge__art">
        <path class="badge__paper" d="M14 33l6-3 6 2.5 6-2.5 6 3-6 3-6-2.5-6 2.5Z" />
        <path class="badge__accent" d="M26 14a6 6 0 0 0-6 6c0 4.3 5 9.2 5.3 9.5a1 1 0 0 0 1.4 0c.3-.3 5.3-5.2 5.3-9.5a6 6 0 0 0-6-6Z" />
        <circle class="badge__dot" cx="26" cy="20" r="2.3" />
      </g>
      <g v-else-if="kind === 'map'" class="badge__art">
        <path class="badge__paper" d="M14 19l7-2.5 10 2.5 7-2.5v17l-7 2.5-10-2.5-7 2.5Z" />
        <path class="badge__line" d="M17 30l5-4 4 3 5-5 4 2" />
        <path class="badge__accent" d="M21 15a3 3 0 0 0-3 3c0 2.2 2.6 4.7 2.7 4.8a.5.5 0 0 0 .6 0c.1-.1 2.7-2.6 2.7-4.8a3 3 0 0 0-3-3Zm11 6a2.6 2.6 0 0 0-2.6 2.6c0 1.9 2.2 4 2.3 4.1a.4.4 0 0 0 .6 0c.1-.1 2.3-2.2 2.3-4.1A2.6 2.6 0 0 0 32 21Z" />
      </g>
      <g v-else class="badge__art">
        <circle class="badge__paper" cx="26" cy="27" r="11" />
        <circle class="badge__face" cx="26" cy="27" r="8.6" />
        <rect class="badge__paper" x="24.6" y="13.5" width="2.8" height="3.5" rx="1" />
        <path class="badge__accent" d="M30.5 22.5 27.4 28.4 25 25.9Z" />
        <path class="badge__paper" d="M21.5 31.5 24.6 25.6 27 28.1Z" />
      </g>
    </svg>
    <span v-if="locked" class="badge__lock" aria-hidden="true">
      <svg width="8" height="8" viewBox="0 0 24 24"><path fill="#fff" d="M7 10V8a5 5 0 0 1 10 0v2h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7Zm2.5 0h5V8a2.5 2.5 0 0 0-5 0v2Z" /></svg>
    </span>
  </span>
</template>

<style scoped lang="scss">
.badge {
  position: relative;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
}
.badge__rim {
  fill: none;
  stroke: #f6b31b;
  stroke-width: 5;
  stroke-linejoin: round;
}
.badge__paper {
  fill: #fdf3d6;
}
.badge__face {
  fill: #1d7fb5;
}
.badge__accent {
  fill: #f8b21c;
}
.badge__dot {
  fill: #2f7fd8;
}
.badge__line {
  fill: none;
  stroke: #2fa35a;
  stroke-width: 1.4;
  stroke-dasharray: 2 1.5;
}

.badge--locked {
  .badge__rim {
    stroke: #e9ecf0;
  }
  .badge__paper,
  .badge__accent {
    fill: #b9c1cb;
  }
  .badge__face,
  .badge__dot {
    fill: #dfe3e8;
  }
  .badge__line {
    stroke: #dfe3e8;
  }
}

.badge__lock {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #667586;
}
</style>
