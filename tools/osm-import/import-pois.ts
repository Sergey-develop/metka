/**
 * Imports organisations (output of osm:fetch-pois) into public.osm_pois and links them to
 * osm_buildings on the server. Import buildings first (npm run osm:import).
 *   npm run osm:import-pois -- <file.json> [--dry-run]
 * Needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment or
 * .env. The service role key is admin-level: never give it a VITE_ prefix and never commit it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { chunk } from './geojson.ts'
import type { OsmPoiInput } from './pois.ts'

const BATCH = 500

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'dry-run': { type: 'boolean', default: false } },
})
const file = positionals[0]
if (!file) {
  console.error('usage: npm run osm:import-pois -- <file.json> [--dry-run]')
  process.exit(2)
}

let items: OsmPoiInput[]
try {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array (output of osm:fetch-pois)')
  items = parsed as OsmPoiInput[] // validated item by item on the server
} catch (e) {
  console.error(`invalid file: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

console.log(`items: ${items.length}`)
if (values['dry-run']) process.exit(0)

if (existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const total = { inserted: 0, updated: 0, unchanged: 0, skipped: [] as { osmId: number | null; reason: string }[] }
for (const [i, batch] of chunk(items, BATCH).entries()) {
  const { data, error } = await supabase.rpc('import_osm_pois', { p_items: batch })
  if (error) {
    console.error(`batch ${i + 1} failed: ${error.message}`)
    process.exit(1)
  }
  const r = data as typeof total
  total.inserted += r.inserted
  total.updated += r.updated
  total.unchanged += r.unchanged
  total.skipped.push(...r.skipped)
}

const { count: linked } = await supabase.from('osm_pois').select('id', { count: 'exact', head: true }).not('osm_building_id', 'is', null)
console.log(
  `inserted: ${total.inserted}, updated: ${total.updated}, unchanged: ${total.unchanged}, skipped: ${total.skipped.length}; ` +
    `linked to a building (all imported): ${linked ?? '?'}`,
)
