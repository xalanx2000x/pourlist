/**
 * Migration 007: Reset OSM-seeded venues to unverified (batched)
 *
 * Does NOT use a single giant UPDATE — splits into batches of 5000
 * using id > last_id cursor to avoid long-held row locks.
 *
 * Run with: node supabase/migrations/007_reset_anonymous_venues.js
 *
 * Or paste the SQL blocks (marked === SQL ===) into Supabase SQL Editor
 * one at a time, noting the last_id between runs.
 */

const { createClient } = require('@supabase/supabase-js')

const url = 'https://cuzkquenafzebdqbuwfk.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var not set')
  process.exit(1)
}

const supabase = createClient(url, key)

const BATCH_SIZE = 5000

async function main() {
  console.log('=== Migration 007: Reset anonymous-Trust venues to unverified ===\n')

  // ── Step 1: Report before counts ──────────────────────────────────────────
  const { data: before } = await supabase
    .from('venues')
    .select('status, contributor_trust, count(*)::text as cnt')
    .in('contributor_trust', ['anonymous', 'new', 'trusted'])
    .groupBy('status, contributor_trust')

  console.log('Before:')
  for (const row of before ?? []) {
    console.log(`  ${row.contributor_trust} / ${row.status}: ${row.cnt}`)
  }
  console.log()

  // ── Step 2: Reset anonymous venues to unverified (batched) ─────────────────
  console.log(`Resetting anonymous-trust venues to unverified (batches of ${BATCH_SIZE})...`)

  let totalReset = 0
  let lastId = null

  while (true) {
    let q = supabase
      .from('venues')
      .update({ status: 'unverified' })
      .eq('contributor_trust', 'anonymous')
      .neq('status', 'unverified')
      .select('id')
      .limit(BATCH_SIZE)

    if (lastId) q = q.gt('id', lastId)

    const { data, count } = await q

    if (!data || data.length === 0) break

    lastId = data[data.length - 1].id
    totalReset += data.length
    console.log(`  Batch: ${data.length} updated, cursor now: ${lastId}`)

    // Small delay to let other queries breathe
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`Total anonymous venues reset to unverified: ${totalReset}\n`)

  // ── Step 3: Restore verified to venues with real user content ────────────
  console.log('Restoring verified to venues with user content...')

  const restoreConditions = [
    {
      label: 'menu_text is not null/empty',
      sql: `UPDATE venues SET status = 'verified' WHERE contributor_trust = 'anonymous' AND (menu_text IS NOT NULL AND trim(menu_text) != '') AND status = 'unverified'`,
    },
    {
      label: 'hh_type is not null',
      sql: `UPDATE venues SET status = 'verified' WHERE contributor_trust = 'anonymous' AND hh_type IS NOT NULL AND status = 'unverified'`,
    },
    {
      label: 'latest_menu_image_url is not null',
      sql: `UPDATE venues SET status = 'verified' WHERE contributor_trust = 'anonymous' AND latest_menu_image_url IS NOT NULL AND status = 'unverified'`,
    },
    {
      label: 'has photos in photos table',
      sql: `UPDATE venues v SET status = 'verified' FROM (SELECT DISTINCT venue_id FROM photos) p WHERE v.id = p.venue_id AND v.contributor_trust = 'anonymous' AND v.status = 'unverified'`,
    },
  ]

  for (const cond of restoreConditions) {
    const { count, error } = await supabase.rpc('execute_sql', { sql: cond.sql }).single()
    // Supabase RPC may not work for raw SQL — fall back to direct approach below
    console.log(`  [${cond.label}] — RPC fallback (expected 0 if RPC not set up)`)
  }

  // Use direct table updates for the restore steps (avoids RPC complexity)
  const restoreSteps = [
    {
      label: 'menu_text is not null/empty',
      query: supabase
        .from('venues')
        .update({ status: 'verified' })
        .eq('contributor_trust', 'anonymous')
        .not('menu_text', 'is', null)
        .neq('menu_text', '')
        .eq('status', 'unverified'),
    },
    {
      label: 'hh_type is not null',
      query: supabase
        .from('venues')
        .update({ status: 'verified' })
        .eq('contributor_trust', 'anonymous')
        .not('hh_type', 'is', null)
        .eq('status', 'unverified'),
    },
    {
      label: 'latest_menu_image_url is not null',
      query: supabase
        .from('venues')
        .update({ status: 'verified' })
        .eq('contributor_trust', 'anonymous')
        .not('latest_menu_image_url', 'is', null)
        .eq('status', 'unverified'),
    },
    {
      label: 'has photos',
      query: null, // handled separately via join below
    },
  ]

  for (const step of restoreSteps) {
    if (!step.query) continue
    const { count, error } = await step.query.select('id', { count: 'exact', head: true })
    if (error) {
      console.log(`  ${step.label}: ERROR — ${error.message}`)
    } else {
      console.log(`  ${step.label}: ${count ?? 0} restored to verified`)
    }
  }

  // Photos check via a subquery
  const { data: photoVenueIds } = await supabase
    .from('photos')
    .select('venue_id')
    .limit(10000)

  if (photoVenueIds && photoVenueIds.length > 0) {
    const ids = [...new Set(photoVenueIds.map(p => p.venue_id))]
    const { count } = await supabase
      .from('venues')
      .update({ status: 'verified' })
      .in('id', ids)
      .eq('contributor_trust', 'anonymous')
      .eq('status', 'unverified')
      .select('id', { count: 'exact', head: true })

    console.log(`  has photos: ${count ?? 0} restored to verified`)
  }

  // ── Step 4: Also clean up non-anonymous venues stuck verified with no content
  console.log('\nCleaning up non-anonymous venues with no content...')

  const { count: nonAnonReset } = await supabase
    .from('venues')
    .update({ status: 'unverified' })
    .not('contributor_trust', 'eq', 'anonymous')
    .eq('status', 'verified')
    .is('menu_text', null)
    .is('hh_type', null)
    .is('latest_menu_image_url', null)
    .eq('photo_count', 0)
    .select('id', { count: 'exact', head: true })

  console.log(`  non-anonymous venues reset: ${nonAnonReset ?? 0}\n`)

  // ── Step 5: Report final counts ───────────────────────────────────────────
  const { data: after } = await supabase
    .from('venues')
    .select('status, contributor_trust, count(*)::text as cnt')
    .in('contributor_trust', ['anonymous', 'new', 'trusted'])
    .groupBy('status, contributor_trust')

  console.log('After:')
  for (const row of after ?? []) {
    console.log(`  ${row.contributor_trust} / ${row.status}: ${row.cnt}`)
  }

  console.log('\n=== Migration 007 complete ===')
}

main().catch(e => {
  console.error('Migration failed:', e)
  process.exit(1)
})
