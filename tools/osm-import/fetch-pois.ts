/**
 * Downloads OSM organisations (named shop/amenity/office/… nodes) for a bbox from Overpass.
 *   npm run osm:fetch-pois -- [--bbox south,west,north,east] [--out file]
 * Default bbox: the same area as osm:fetch (~1.3 km around metro "Varshavskaya").
 * Data © OpenStreetMap contributors, ODbL. Respect the Overpass usage policy: one-off imports only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { overpassToPois, poisQuery } from './pois.ts'

const VARSHAVSKAYA = '55.641,37.600,55.666,37.640'
const ENDPOINT = 'https://overpass-api.de/api/interpreter'

const { values } = parseArgs({
  options: {
    bbox: { type: 'string', default: VARSHAVSKAYA },
    out: { type: 'string', default: 'data/osm/varshavskaya-pois.json' },
  },
})

const parts = values.bbox.split(',').map(Number)
if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
  console.error('--bbox must be south,west,north,east')
  process.exit(2)
}
const [south, west, north, east] = parts as [number, number, number, number]

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'metka-osm-import/0.1' },
  body: new URLSearchParams({ data: poisQuery({ south, west, north, east }) }),
})
if (!response.ok) {
  console.error(`Overpass error ${response.status}: ${(await response.text()).slice(0, 300)}`)
  process.exit(1)
}
const { items, skipped } = overpassToPois(await response.json())
mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, JSON.stringify(items))
const explicit = items.filter((i) => i.hostWayIds.length > 0).length
console.log(`${items.length} organisations (${explicit} on a building outline), skipped ${skipped.length} → ${values.out}`)
