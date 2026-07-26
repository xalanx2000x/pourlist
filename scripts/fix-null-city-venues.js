#!/usr/bin/env node
/**
 * scripts/fix-null-city-venues.js
 * Geocode 9 NYC venues that have lat/lng but null city/state,
 * then assign slugs and clear needs_geo_review.
 */

import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => { const [k, ...v] = l.split('='); return [k, v.join('=')] })
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const MAPBOX_TOKEN = env.NEXT_PUBLIC_MAPBOX_TOKEN

// ─── geocode via Mapbox ──────────────────────────────────────────────────────
async function reverseGeocode(lat, lng) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const f = data.features?.[0]
  if (!f) return null

  let city = null, state = null, neighborhood = null, zip = null
  for (const c of f.context || []) {
    const id = c.id || ''
    if (id.startsWith('place.')) city = c.text
    else if (id.startsWith('region.')) {
      const code = c.short_code?.split('-').pop()
      state = code || c.text
    } else if (id.startsWith('neighborhood.')) neighborhood = c.text
    else if (id.startsWith('country.')) {
      if (c.short_code === 'US') { /* ok */ }
    }
  }
  return { city, state, neighborhood, zip }
}

// ─── slugify ────────────────────────────────────────────────────────────────
function slugifyName(n) {
  return (n ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['\u2018-\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'venue'
}
function slugifyCity(c) { return slugifyName(c) }
function uniqueInCity(slug, taken) {
  if (!taken.has(slug)) return slug
  for (let i = 2; i <= 99; i++) { if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}` }
  return `${slug}-${Date.now()}`
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main() {
  // Fetch all non-seed venues with null city + valid coords
  const { data: venues } = await supabase
    .from('venues').select('id, name, city, state, lat, lng')
    .eq('is_seed_data', false).is('city', null).not('lat', 'is', null)
    .not('lng', 'is', null)

  if (!venues?.length) { console.log('No venues to fix'); return }
  console.log(`Found ${venues.length} venues with null city\n`)

  for (const v of venues) {
    console.log(`Geocoding: ${v.name} (${v.lat}, ${v.lng})`)
    const geo = await reverseGeocode(v.lat, v.lng)
    if (!geo || !geo.city || !geo.state) {
      console.log(`  ⚠ Could not geocode — skipping ${v.id}`)
      continue
    }
    console.log(`  → ${geo.city}, ${geo.state} (neighborhood: ${geo.neighborhood})`)

    // Load existing slugs for city
    const { data: existing } = await supabase
      .from('venues').select('new_slug').eq('city', geo.city).eq('state', geo.state).not('new_slug', 'is', null)
    const taken = new Set(existing.map(r => { const p = r.new_slug?.split('/'); return p?.[2] ?? null }).filter(Boolean))

    const venueSlug = slugifyName(v.name)
    const citySlug = slugifyCity(geo.city)
    const unique = uniqueInCity(venueSlug, taken)
    const newSlug = `/${geo.state.toLowerCase()}/${citySlug}/${unique}`

    const { error } = await supabase.from('venues').update({
      city: geo.city, state: geo.state,
      neighborhood: geo.neighborhood ?? null,
      new_slug: newSlug,
      needs_geo_review: false,
    }).eq('id', v.id)

    if (error) console.log(`  ❌ PATCH failed: ${error.message}`)
    else console.log(`  ✅ ${newSlug}`)
  }
}

main().catch(err => { console.error('\n❌ FAILED:', err.message); process.exit(1) })
