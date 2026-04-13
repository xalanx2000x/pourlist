/**
 * seed-osm.ts — Seed PourList with venues from OpenStreetMap (OSM)
 *
 * Uses the OSM Overpass API to find bars, restaurants, pubs, and breweries
 * in US cities and insert them into Supabase.
 *
 * Usage:
 *   npx ts-node scripts/seed-osm.ts                   # all 50 cities
 *   npx ts-node scripts/seed-osm.ts --cities=Austin,Seattle  # specific
 *   npx ts-node scripts/seed-osm.ts --dry-run               # preview only
 *
 * No API key needed. OSM data is free to use with attribution.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── 50 US metros ───────────────────────────────────────────────────────────────

const CITIES = [
  'New York City, NY','Los Angeles, CA','Chicago, IL','Houston, TX',
  'Phoenix, AZ','Philadelphia, PA','San Antonio, TX','San Diego, CA',
  'Dallas, TX','San Jose, CA','Austin, TX','Jacksonville, FL',
  'Fort Worth, TX','Columbus, OH','Indianapolis, IN','Charlotte, NC',
  'San Francisco, CA','Seattle, WA','Denver, CO','Washington DC',
  'Boston, MA','Nashville, TN','Baltimore, MD','Oklahoma City, OK',
  'Louisville, KY','Portland, OR','Las Vegas, NV','Milwaukee, WI',
  'Albuquerque, NM','Tucson, AZ','Fresno, CA','Sacramento, CA',
  'Mesa, AZ','Kansas City, MO','Atlanta, GA','Miami, FL',
  'Raleigh, NC','Omaha, NE','Minneapolis, MN','Cleveland, OH',
  'Tampa, FL','Arlington, TX','New Orleans, LA','Bakersfield, CA',
  'Tulsa, OK','Honolulu, HI','Anaheim, CA','Santa Ana, CA',
  'Corpus Christi, TX','Riverside, CA','Salt Lake City, UT',
  'Pittsburgh, PA','St. Louis, MO','Cincinnati, OH','Orlando, FL','Buffalo, NY',
]

// ── OSM helpers ──────────────────────────────────────────────────────────────

async function getBounds(city: string): Promise<[number,number,number,number]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'PourList/1.0 (seeding)' } }
  )
  const data = await res.json() as Array<{ boundingbox: string[] }>
  if (!data?.length) throw new Error(`City not found: ${city}`)
  const bb = data[0].boundingbox.map(Number)
  return [bb[0], bb[2], bb[1], bb[3]] // south, west, north, east
}

async function queryOSM(bounds: [number,number,number,number]) {
  const [south, west, north, east] = bounds
  const q = `
[out:json][timeout:90];
(
  node["amenity"="bar"](${south},${west},${north},${east});
  node["amenity"="restaurant"](${south},${west},${north},${east});
  node["amenity"="pub"](${south},${west},${north},${east});
  node["amenity"="brewery"](${south},${west},${north},${east});
  node["leisure"="pub"](${south},${west},${north},${east});
  node["amenity"="nightclub"](${south},${west},${north},${east});
);
out body;
`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: q }).toString(),
  })
  const d = await res.json() as { elements: unknown[] }
  return d.elements || []
}

function normType(amenity: string) {
  const map: Record<string, string> = {
    bar:'Bar', restaurant:'Restaurant', pub:'Pub',
    brewery:'Brewery', nightclub:'Nightclub', leisure:'Pub',
  }
  return map[amenity] || 'Bar'
}

function formatAddr(n: string|null, s: string|null, c: string|null, st: string|null, z: string|null) {
  const parts = [n && s ? `${n} ${s}` : n || s, c, st && z ? `${st} ${z}` : st].filter(Boolean)
  return parts.join(', ') || 'Unknown'
}

// ── Seed one city ─────────────────────────────────────────────────────────────

async function seedCity(citySearch: string, dryRun: boolean) {
  const name = citySearch.split(',')[0].trim()
  process.stdout.write(`\n🌆 ${name}... `)

  try {
    const bounds = await getBounds(citySearch)
    const elements = await queryOSM(bounds)

    const venues = (elements as Record<string, unknown>[])
      .map(el => {
        const tags = (el.tags as Record<string, string>) || {}
        return {
          osm_id: el.id as number,
          name: tags.name || tags['name:en'] || null,
          amenity: tags.amenity || tags.leisure || 'bar',
          n: tags['addr:housenumber'] || null,
          s: tags['addr:street'] || null,
          c: tags['addr:city'] || null,
          st: tags['addr:state'] || null,
          z: tags['addr:postcode'] || null,
          lat: el.lat as number,
          lon: el.lon as number,
        }
      })
      .filter(v => v.name && v.lat && v.lon)

    console.log(`${venues.length} found${dryRun ? ' (dry run)' : ''}`)

    if (dryRun || venues.length === 0) return { found: venues.length, inserted: 0 }

    // Deduplicate by name + city
    const seen = new Set<string>()
    const records = venues
      .filter(v => {
        const key = `${v.name}|${name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(v => ({
        name: v.name!,
        address: formatAddr(v.n, v.s, v.c, v.st, v.z),
        lat: v.lat,
        lng: v.lon,
        zip: v.z,
        type: normType(v.amenity),
        status: 'unverified',
        contributor_trust: 'osm-seed',
        created_at: new Date().toISOString(),
      }))

    const CHUNK = 100
    let inserted = 0
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK)
      const { error } = await supabase.from('venues').insert(chunk)
      if (error) console.error(`    insert error: ${error.message}`)
      else inserted += chunk.length
    }

    console.log(`  → ${inserted} inserted`)
    return { found: venues.length, inserted }
  } catch (err) {
    console.log(`❌ ${err}`)
    return { found: 0, inserted: 0 }
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const citiesArg = args.find(a => a.startsWith('--cities='))
  const cityFilter = citiesArg ? citiesArg.split('=')[1].split(',').map(c => c.trim()) : null

  const cities = cityFilter
    ? CITIES.filter(c => cityFilter.includes(c.split(',')[0].trim()))
    : CITIES

  console.log(`\n🍺 PourList OSM Seeder`)
  console.log(`   Cities: ${cities.length}${cityFilter ? ` (${cityFilter.join(', ')})` : ' (all)'}`)
  console.log(`   Dry run: ${dryRun ? 'YES' : 'NO'}\n`)

  let total = 0, inserted = 0
  for (const city of cities) {
    const r = await seedCity(city, dryRun)
    total += r.found
    inserted += r.inserted
  }

  console.log(`\n✅ Done — ${total} found, ${inserted} inserted`)
}

main().catch(console.error)