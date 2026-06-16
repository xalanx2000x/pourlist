#!/usr/bin/env node
/**
 * Backfill venue slugs — concurrent batch via REST API.
 *
 * Uses the Supabase REST API (service role key) to write slugs.
 * Batches of 50, up to 20 concurrent batches = 1,000 parallel requests.
 * 59K rows / 1,000 per batch wave ≈ 60 waves × ~5 seconds ≈ 5 minutes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/backfill-venue-slugs.mjs           # dry run
 *   node --experimental-strip-types scripts/backfill-venue-slugs.mjs --write   # actually write
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { generateVenueSlug } from '../src/lib/slug.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envFile, 'utf8')
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const write = process.argv.includes('--write')
const dryRun = !write
const CONCURRENCY = 1    // sequential — one batch at a time, safe and reliable
const BATCH = 100        // rows per batch (1 HTTP request = 1 batch = BATCH rows, but all get the SAME slug value — wrong, see below)

// NOTE: Since Supabase REST doesn't support per-row different values in a single
// PATCH, each ROW is its own batch. BATCH is only used for progress reporting.

async function fetchVenues(offset) {
  // Fetch all venues that need a slug.
  const url = `${SUPABASE_URL}/rest/v1/venues?select=id,name,slug&slug=is.null&offset=${offset}&limit=5000`
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) throw new Error(`Failed to fetch venues: ${res.status} ${await res.text()}`)
  const total = res.headers.get('content-range')?.split('/')[1]
  return { data: await res.json(), total: total ? parseInt(total) : null }
}

async function patchVenue(id, slug, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/venues?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ slug }),
        }
      )
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1000))
        continue
      }
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status}: ${text}`)
      }
      return
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 500))
    }
  }
}

async function main() {
  console.log(dryRun ? '=== DRY RUN (pass --write to commit) ===' : '=== WRITE MODE ===')

  // Load all venues needing slugs (paginate)
  let allVenues = []
  let offset = 0
  let total = null
  while (true) {
    const result = await fetchVenues(offset)
    if (total === null && result.total !== null) total = result.total
    if (!result.data || result.data.length === 0) break
    allVenues.push(...result.data)
    if (result.data.length < 5000 || allVenues.length >= (total ?? Infinity)) break
    offset += 5000
  }
  if (total === null) total = allVenues.length
  console.log(`Venues needing slug: ${total}`)

  if (allVenues.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Compute slugs
  const existingSlugs = new Set()
  const slugById = new Map()
  let collisions = 0

  for (const v of allVenues) {
    const slug = generateVenueSlug(v, existingSlugs)
    existingSlugs.add(slug)
    slugById.set(v.id, slug)
    if (!slug.endsWith(v.id.replace(/-/g, '').slice(0, 6))) collisions++
  }

  console.log(`Collisions resolved: ${collisions}`)
  for (const [i, v] of allVenues.entries()) {
    if (i >= 5) break
    console.log(`  ${v.name} → ${slugById.get(v.id)}`)
  }

  if (dryRun) {
    console.log(`(dry run — re-run with --write to commit)`)
    return
  }

  // Sequential writes — one venue at a time, 50ms delay between each.
  // ~35 venues × 50ms = ~2 seconds. Acceptable.
  console.log(`Writing ${allVenues.length} venues sequentially (50ms delay between each)…`)
  let done = 0
  let failed = 0
  const errors = []

  for (let i = 0; i < allVenues.length; i++) {
    const v = allVenues[i]
    const slug = slugById.get(v.id)
    try {
      await patchVenue(v.id, slug)
      done++
    } catch (e) {
      failed++
      errors.push(String(e).slice(0, 100))
    }
    if (i % 10 === 0 || i === allVenues.length - 1) {
      console.log(`  …${done + failed}/${allVenues.length} done`)
    }
    await new Promise(r => setTimeout(r, 50))
  }

  console.log('---')
  console.log(`Updated: ${done}`)
  console.log(`Failed:  ${failed}`)
  if (errors.length > 0) console.log(`First errors:`, errors.slice(0, 3))
  if (errors.length > 0) {
    console.log(`First few errors:`)
    for (const e of errors.slice(0, 3)) console.log('  ', e)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
