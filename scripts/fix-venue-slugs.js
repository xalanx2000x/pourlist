#!/usr/bin/env node
/**
 * scripts/fix-venue-slugs.js
 * One-shot data migration. Run: node scripts/fix-venue-slugs.js
 */

import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => { const [k,...v] = l.split('='); return [k, v.join('=')] })
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ─── normalizeState (mirrors route.ts) ───────────────────────────────────────
const STATE_ABBREV = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
  'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI',
  'american samoa': 'AS', 'northern mariana islands': 'MP',
}
function normalizeState(s) {
  if (!s) return null
  if (/^[A-Z]{2}$/.test(s)) return s
  return STATE_ABBREV[s.toLowerCase()] ?? s
}

// ─── slugify (mirrors slug.ts) ───────────────────────────────────────────────
function slugifyName(name) {
  return (name ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['\u2018\u2019\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'venue'
}
function slugifyCity(city) { return slugifyName(city) }

function uniqueInCity(slug, taken) {
  if (!taken.has(slug)) return slug
  for (let i = 2; i <= 99; i++) { if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}` }
  return `${slug}-${Date.now()}`
}

// ─── db helpers ─────────────────────────────────────────────────────────────
async function patch(id, updates) {
  const { error } = await supabase.from('venues').update(updates).eq('id', id)
  if (error) throw new Error(`PATCH ${id}: ${error.message}`)
}

async function del(id) {
  const { error } = await supabase.from('venues').delete().eq('id', id)
  if (error) throw new Error(`DELETE ${id}: ${error.message}`)
}

async function loadTakenSlugs(cities) {
  // Query by city only — slug uniqueness is scoped per-city, state doesn't affect
  // the 3rd-path fragment. Store with normalized state key.
  const taken = new Map()
  for (const { city, state } of cities) {
    const normState = normalizeState(state)
    const key = `${normState}/${city}`
    if (taken.has(key)) continue
    const { data } = await supabase
      .from('venues').select('new_slug')
      .eq('city', city).not('new_slug', 'is', null)
    taken.set(key, new Set(
      (data ?? []).map(r => { const p = r.new_slug?.split('/'); return p?.[2] ?? null }).filter(Boolean)
    ))
  }
  return taken
}

function makeSlug(name, city, state, taken) {
  const venueSlug = slugifyName(name)
  const citySlug = slugifyCity(city)
  const key = `${state}/${city}`
  const unique = uniqueInCity(venueSlug, taken.get(key) ?? new Set())
  taken.get(key).add(unique)
  return `/${state.toLowerCase()}/${citySlug}/${unique}`
}

// ─── phases ─────────────────────────────────────────────────────────────────
async function main() {
  // Collect all city+state pairs we'll touch (deduped via Map)
  const allCities = new Map()

  // PHASE 1: 24 bad-state venues
  const badStateIds = [
    '2a774a99-7df7-4517-bf25-d628acefcb53', '9637f0fc-be54-4847-ada7-36a31ef88f48',
    '5a12eb18-5a86-475f-9b00-11757f670b57', '13c4e1db-4e36-4fb2-86d2-0a2836e91202',
    '13d442e2-3bbe-42a7-8513-6c70e63839fe', '55de481b-6d7f-4eb9-bdda-56706cb47ab9',
    'fec27ea7-09c1-4375-8976-04c58e921d2b', '552b2b9c-a684-4f05-9502-4bd7349acd8f',
    'aece32ae-3d11-472d-b2b7-c7cbc43ff9ff', 'd9cd98ae-5ae1-4fbf-89b5-9b94291d137d',
    '3d590a03-cefc-4dbb-a681-a1fd3967fe26', '5154185d-408f-40cf-a292-9fdd612d0fbb',
    'a9641964-4d99-4283-a701-06066fec6d23', 'fc5ee964-d789-4390-8a00-97a2f5092daa',
    '8ece76a6-5db6-45f7-bc6d-f07137902cc9', '013a021f-5c64-4581-9c8c-60ff588aadb8',
    '751b5f77-de9e-4efc-b47d-b77afd9d624f', '114cd4d1-8e77-47f1-8916-02c38705313d',
    '14ca11d1-195a-4380-ab49-31d4e33a4139', 'fac9afe4-9143-4099-b9ee-822631c28520',
    '67c8555a-7a5e-43d0-837d-4ae9a8468a74', '9f4c9e68-c135-4d6a-916e-19446867bddb',
    '435831fa-6099-4b6d-bfa3-f5e2184cf39d', 'f65f5e23-f3e4-45b8-9aa5-f0f80be01230',
  ]

  const { data: phase1Venues } = await supabase
    .from('venues').select('id, name, city, state, neighborhood, new_slug, needs_geo_review')
    .in('id', badStateIds)
  if (!phase1Venues?.length) throw new Error('Phase1: no venues fetched')
  for (const v of phase1Venues) allCities.set(`${v.state}/${v.city}`, { city: v.city, state: v.state })

  // PHASE 2: venues with null slug + needs_geo_review (exclude phase1 ids)
  const { data: allNullSlug } = await supabase
    .from('venues').select('id, name, city, state')
    .eq('is_seed_data', false).is('new_slug', null).eq('needs_geo_review', true)
    .limit(300)
  const phase2Venues = (allNullSlug ?? []).filter(v => !badStateIds.includes(v.id))
  console.log(`  Total null-slug venues: ${allNullSlug?.length ?? 0}, after excluding phase1: ${phase2Venues.length}`)
  for (const v of (phase2Venues ?? [])) allCities.set(`${v.state}/${v.city}`, { city: v.city, state: v.state })

  // Pre-load taken slugs for all cities we'll touch
  const taken = await loadTakenSlugs([...allCities.values()])
  console.log(`Loaded slugs for ${taken.size} cities\n`)

  // PHASE 1: normalize state + fix slug
  console.log('=== PHASE 1: Normalize state + slug (24 venues) ===')
  for (const v of phase1Venues) {
    const newState = normalizeState(v.state)
    const slug = makeSlug(v.name, v.city, newState, taken)
    console.log(`  ${v.name}: ${v.state}→${newState} | ${slug}`)
    await patch(v.id, { state: newState, new_slug: slug, needs_geo_review: false })
  }

  // PHASE 2: assign slug to null-slug venues (state already correct)
  console.log(`\n=== PHASE 2: Assign slugs (${phase2Venues.length} venues) ===`)
  for (const v of (phase2Venues ?? [])) {
    const slug = makeSlug(v.name, v.city, v.state, taken)
    console.log(`  ${v.name} (${v.city}, ${v.state}): ${slug}`)
    await patch(v.id, { new_slug: slug, needs_geo_review: false })
  }

  // PHASE 3: clear needs_geo_review on edge cases (have slug, still flagged)
  console.log('\n=== PHASE 3: Clear needs_geo_review on 2 edge cases ===')
  const edgeCases = [
    '51900c28-6465-476b-9d94-ad5df18e74c9', // Il Corso
    'd903d1a3-5b34-4c0d-be65-8954b87a6954', // Jolly Rodger
  ]
  for (const id of edgeCases) {
    await patch(id, { needs_geo_review: false })
    console.log(`  Cleared: ${id}`)
  }

  // PHASE 4: delete duplicate Rondo seed stub
  console.log('\n=== PHASE 4: Delete duplicate Rondo seed stub ===')
  await del('87322c58-d654-48ff-a721-8275775c0e91')
  console.log('  Deleted: 87322c58-d654-48ff-a721-8275775c0e91')

  console.log('\n✅ All phases complete')
}

main().catch(err => { console.error('\n❌ FAILED:', err.message); process.exit(1) })
