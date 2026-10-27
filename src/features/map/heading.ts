import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { services } from '@/app/providers/services'
import type { HeadingReading } from '@/services/orientation/types'

/** share of a new reading in the smoothed heading: the arrow follows the phone without jitter */
const SMOOTHING = 0.25

/**
 * Where the player faces, for the arrow at their dot on the map; null while there is no compass.
 * iOS lets the page ask for the compass only from a tap: then the first tap on the screen asks.
 */
export function useMapHeading(): Ref<number | null> {
  const heading = ref<number | null>(null)
  let smooth: { x: number; y: number } | null = null
  let stop: (() => void) | null = null
  let disposed = false

  function onReading(r: HeadingReading): void {
    const rad = (r.facingDeg * Math.PI) / 180
    const x = Math.sin(rad)
    const y = Math.cos(rad)
    // averaged as a vector, so 359° and 1° give 0°, not 180°
    smooth = smooth ? { x: smooth.x + (x - smooth.x) * SMOOTHING, y: smooth.y + (y - smooth.y) * SMOOTHING } : { x, y }
    heading.value = ((Math.atan2(smooth.x, smooth.y) * 180) / Math.PI + 360) % 360
  }

  async function start(): Promise<void> {
    const { orientation } = services()
    if (disposed || stop || !orientation.isSupported()) return
    const permission = await orientation.requestPermission()
    if (disposed || stop) return
    if (permission === 'granted') {
      stop = orientation.watchHeading(onReading, () => {
        heading.value = null
      })
    } else if (permission === 'prompt') {
      document.addEventListener('click', onFirstTap, { once: true, capture: true })
    }
  }
  function onFirstTap(): void {
    void start()
  }

  onMounted(() => void start())
  onBeforeUnmount(() => {
    disposed = true
    document.removeEventListener('click', onFirstTap, { capture: true })
    stop?.()
    stop = null
  })
  return heading
}
