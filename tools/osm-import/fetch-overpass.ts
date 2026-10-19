/**
 * Downloads OSM buildings for a bbox from the Overpass API and writes GeoJSON.
 *   npm run osm:fetch -- [--bbox south,west,north,east] [--out file]
 * Default bbox: ~1.3 km around metro "Varshavskaya" (Moscow).
 * Data © OpenStreetMap contributors, ODbL. Respect the Overpass usage policy: one-off imports only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { buildingsQuery, overpassToGeoJson } from './overpass.ts'

const VARSHAVSKAYA = '55.641,37.600,55.666,37.640'
const ENDPOINT = 'https://overpass-api.de/api/interpreter'

const { values } = parseArgs({
  options: {
    bbox: { type: 'string', default: VARSHAVSKAYA },
    out: { type: 'string', default: 'data/osm/varshavskaya.geojson' },
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
  body: new URLSearchParams({ data: buildingsQuery({ south, west, north, east }) }),
})
if (!response.ok) {
  console.error(`Overpass error ${response.status}: ${(await response.text()).slice(0, 300)}`)
  process.exit(1)
}
const geojson = overpassToGeoJson(await response.json())
mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, JSON.stringify(geojson))
console.log(`${geojson.features.length} building features → ${values.out}`)
