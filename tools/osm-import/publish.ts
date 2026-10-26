/**
 * Makes the imported OSM outlines of a bbox published game buildings (scannable, with rewards).
 *   npm run osm:publish -- --bbox south,west,north,east
 * Run after osm:import for the same bbox. Outhouses (garage, shed, service, …) are skipped and
 * buildings already in the catalog are left as they are (publish_osm_buildings_in_bbox, migration
 * 022); only outlines inside a game area are taken. Needs SUPABASE_URL (or VITE_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY in the environment or .env — never with a VITE_ prefix, never committed.
 */
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { values } = parseArgs({ options: { bbox: { type: 'string' } } })
const parts = (values.bbox ?? '').split(',').map(Number)
if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
  console.error('usage: npm run osm:publish -- --bbox south,west,north,east')
  process.exit(2)
}
const [south, west, north, east] = parts as [number, number, number, number]

if (existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error } = await supabase.rpc('publish_osm_buildings_in_bbox', {
  p_min_lat: south,
  p_min_lng: west,
  p_max_lat: north,
  p_max_lng: east,
})
if (error) {
  console.error(`publish failed: ${error.message}`)
  process.exit(1)
}
const r = data as { created: number; publishedInBbox: number }
console.log(`new game buildings: ${r.created}, published in the bbox now: ${r.publishedInBbox}`)
