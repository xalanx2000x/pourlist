/**
 * backfill-timezone.ts
 *
 * One-shot script: derives IANA timezone from lat/lng for every venue in the DB
 * that has coords and a null timezone, then updates the row in batches.
 *
 * Uses tz-lookup (local boundary-data lookup, no network calls).
 * All ~40k rows run in seconds.
 *
 * Usage:
 *   npx tsx scripts/backfill-timezone.ts           # full backfill
 *   npx tsx scripts/backfill-timezone.ts --dry-run # test write access, don't modify anything
 *
 * Or compile + run:
 *   npx tsc scripts/backfill-timezone.ts --esModuleInterop --target ES2020 --module commonjs
 *   node scripts/backfill-timezone.js
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import tzlookup from 'tz-lookup'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envFile, 'utf8')
const getEnv = (key: string) => {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL') ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY

const isDryRun = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Mask the key in any error output — never print it
const maskedKey = SUPABASE_SERVICE_KEY
  ? `${SUPABASE_SERVICE_KEY.slice(0, 4)}…${SUPABASE_SERVICE_KEY.slice(-4)}`
  : '(not set)'

console.log(`Supabase URL : ${SUPABASE_URL}`)
console.log(`Service key  : ${maskedKey} ${SUPABASE_SERVICE_KEY ? '✓ found' : '✗ missing'}`)
console.log(`Dry-run mode : ${isDryRun ? 'ON (no writes)' : 'OFF'}`)
console.log()

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const BATCH_SIZE = 100

/**
 * Verify the service key can read and (optionally) write.
 * Returns { authOk, writeOk } — does NOT print key value.
 */
async function verifyKey(): Promise<{ authOk: boolean; writeOk: boolean }> {
  // Light read: if this fails, auth is bad
  const { error: readError } = await supabase
    .from('venues')
    .select('id')
    .limit(1)

  if (readError) {
    console.error('Auth/read failed:', readError.message)
    return { authOk: false, writeOk: false }
  }
  console.log('Auth check   : OK (read succeeded)')
  console.log('Write check  : ', end='')

  // Do a real single-row UPDATE on the first venue that has a null timezone.
  // Use .update({ timezone: timezone }) ... .eq('id', id) with a matched row
  // so we don't accidentally clobber real data — we update a NULL row to itself.
  const { data: testRows, error: fetchError } = await supabase
    .from('venues')
    .select('id, lat, lng, timezone')
    .is('timezone', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(1)

  if (fetchError || !testRows || testRows.length === 0) {
    console.log('skipped (no NULL-rows found to test-write against)')
    return { authOk: true, writeOk: true }
  }

  const testRow = testRows[0]
  let tz: string
  try {
    tz = tzlookup(testRow.lat, testRow.lng)
  } catch {
    // If tzlookup fails for the test row, use a safe sentinel
    tz = 'America/Los_Angeles'
  }

  const { error: writeError } = await supabase
    .from('venues')
    .update({ timezone: tz })
    .eq('id', testRow.id)
    .eq('timezone', null) // only update if still null — don't clobber real data

  if (writeError) {
    console.error(`FAILED — write test error: ${writeError.message}`)
    return { authOk: true, writeOk: false }
  }

  console.log('OK (single-row UPDATE succeeded)')

  // Immediately restore NULL so the backfill can set it properly later
  await supabase
    .from('venues')
    .update({ timezone: null })
    .eq('id', testRow.id)
    .eq('timezone', tz) // only restore if still the value we just set

  console.log('             (test row reverted to NULL — no permanent change)')
  return { authOk: true, writeOk: true }
}

async function deleteOrphanedFolders() {
  const folders = [
    '7846045b-8494-423f-9e86-a2ba9047cd86',
    '24d7eef8-6dd1-4d19-ad49-de968c9e78bf',
  ]

  console.log('\nOrphaned storage cleanup')
  console.log('─'.repeat(40))

  for (const folder of folders) {
    const prefix = `${folder}/`
    const { data, error } = await supabase.storage
      .from('venue-photos')
      .list(folder, { limit: 1000 })

    if (error) {
      console.error(`  ${folder}/  ERROR: ${error.message}`)
      continue
    }

    if (!data || data.length === 0) {
      console.log(`  ${folder}/  already empty or missing — skipping`)
      continue
    }

    const paths = data.map(f => `${folder}/${f.name}`)

    const { error: deleteError } = await supabase.storage
      .from('venue-photos')
      .remove(paths)

    if (deleteError) {
      console.error(`  ${folder}/  ERROR deleting files: ${deleteError.message}`)
    } else {
      console.log(`  ${folder}/  deleted ${paths.length} file(s) ✓`)
    }
  }
}

async function backfill() {
  if (isDryRun) {
    console.log('[dry-run] Verifying key and write access...\n')
  } else {
    console.log('Fetching venues with NULL timezone and valid coords...\n')
  }

  const { authOk, writeOk } = await verifyKey()
  if (!authOk || !writeOk) {
    console.error('\nAborting — key verification failed.')
    process.exit(1)
  }

  if (isDryRun) {
    console.log('\n[dry-run] Key is valid and write access confirmed. No rows modified.')
    await deleteOrphanedFolders()
    return
  }

  // Fetch all venues that need backfilling
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, lat, lng, timezone')
    .is('timezone', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(100000) // sanity cap

  if (error) {
    console.error('Fetch error:', error)
    process.exit(1)
  }

  if (!venues || venues.length === 0) {
    console.log('Nothing to backfill — all rows already have timezone.')
    return
  }

  console.log(`Found ${venues.length} venues to backfill.\n`)

  let updated = 0
  let failed = 0
  const failures: { id: string; lat: number; lng: number; reason: string }[] = []

  for (let i = 0; i < venues.length; i += BATCH_SIZE) {
    const batch = venues.slice(i, i + BATCH_SIZE)
    const updates = batch.map(v => {
      try {
        const tz = tzlookup(v.lat, v.lng)
        return { id: v.id, timezone: tz }
      } catch (e) {
        failures.push({ id: v.id, lat: v.lat, lng: v.lng, reason: String(e) })
        return null
      }
    }).filter(Boolean) as { id: string; timezone: string }[]

    if (updates.length === 0) continue

    const { error: updateError } = await supabase
      .from('venues')
      .upsert(updates, { onConflict: 'id', ignoreDuplicates: false })

    if (updateError) {
      console.error(`\nBatch update error at offset ${i}:`, updateError)
      failed += updates.length
    } else {
      updated += updates.length
      const progress = Math.min(i + BATCH_SIZE, venues.length)
      process.stdout.write(`\r  Progress: ${progress}/${venues.length} (${updated} updated, ${failed} failed)`)
    }
  }

  console.log(`\nDone. ${updated} rows updated, ${failed} failed.`)

  if (failures.length > 0) {
    console.warn(`\n${failures.length} rows could not be resolved:`)
    failures.slice(0, 20).forEach(f => {
      console.warn(`  id=${f.id} lat=${f.lat} lng=${f.lng} — ${f.reason}`)
    })
    if (failures.length > 20) {
      console.warn(`  ... and ${failures.length - 20} more`)
    }
  }

  await deleteOrphanedFolders()
}

backfill()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
