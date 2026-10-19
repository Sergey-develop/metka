/**
 * Imports OSM building GeoJSON into public.osm_buildings (idempotent upsert by osm type + id).
 *   npm run osm:import -- <file.geojson> [--dry-run]
 * Needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment
 * or .env. The service role key is admin-level: never give it a VITE_ prefix (it would ship
 * in the app bundle) and never commit it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { chunk, GeoJsonFormatError, parseOsmGeoJson, type SkippedFeature } from './geojson.ts'

const BATCH = 500

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'dry-run': { type: 'boolean', default: false } },
})
const file = positionals[0]
if (!file) {
  console.error('usage: npm run osm:import -- <file.geojson> [--dry-run]')
  process.exit(2)
}

let parsed: ReturnType<typeof parseOsmGeoJson>
try {
  parsed = parseOsmGeoJson(JSON.parse(readFileSync(file, 'utf8')))
} catch (e) {
  console.error(e instanceof GeoJsonFormatError || e instanceof SyntaxError ? `invalid file: ${e.message}` : e)
  process.exit(1)
}

const countBy = (items: { reason: string }[]) =>
  items.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {})

console.log(`valid: ${parsed.features.length}, skipped locally: ${parsed.skipped.length}`, countBy(parsed.skipped))
if (values['dry-run']) process.exit(0)

if (existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

interface BatchReport {
  inserted: number
  updated: number
  unchanged: number
  skipped: { osmType: string; osmId: number; reason: string }[]
}
const total: BatchReport = { inserted: 0, updated: 0, unchanged: 0, skipped: [] }
for (const [i, batch] of chunk(parsed.features, BATCH).entries()) {
  const { data, error } = await supabase.rpc('import_osm_buildings', { p_features: batch })
  if (error) {
    console.error(`batch ${i + 1} failed: ${error.message}`)
    process.exit(1)
  }
  const r = data as BatchReport
  total.inserted += r.inserted
  total.updated += r.updated
  total.unchanged += r.unchanged
  total.skipped.push(...r.skipped)
}

const local: SkippedFeature[] = parsed.skipped
console.log(
  `inserted: ${total.inserted}, updated: ${total.updated}, unchanged: ${total.unchanged}, ` +
    `skipped: ${local.length + total.skipped.length}`,
  countBy([...local, ...total.skipped]),
)
