/**
 * cleanup-duplicates.mjs
 * Run once to remove true duplicate venues from the database.
 * True duplicate = same normalized name + within 50m
 * 
 * Usage: node scripts/cleanup-duplicates.mjs
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').trim().split('\n').map(line => line.split('='))
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Status rank: lower = better to keep
// verified > unverified > new > stale
// stale is worst — means users flagged it as defunct or moved
const STATUS_RANK = { verified: 0, unverified: 1, new: 2, stale: 3 }

function norm(n) {
  return n.replace(/^the\s+/i, '').toLowerCase().trim()
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function fetchAllVenues() {
  const SKIP = 1000
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY
  const URL = env.NEXT_PUBLIC_SUPABASE_URL
  const headers = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json'
  }
  let all = []
  let offset = 0
  while (true) {
    const res = await fetch(
      `${URL}/rest/v1/venues?select=id,name,lat,lng,status&status=neq.closed&lat=not.is.null&limit=${SKIP}&offset=${offset}`,
      { headers }
    )
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    process.stdout.write(`  ...fetched ${all.length}\r`)
    if (data.length < SKIP) break
    offset += SKIP
  }
  console.log(`\nFetched ${all.length} venues via REST API`)
  return all
}

async function main() {
  const allVenues = await fetchAllVenues()

  // Group by normalized name to avoid O(n²) comparisons
  const groups = new Map()
  for (const v of allVenues) {
    const key = norm(v.name)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(v)
  }

  // Only check groups with 2+ entries (same normalized name)
  const toDelete = new Set()
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    // Check all pairs within the group
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        if (!a.lat || !a.lng || !b.lat || !b.lng) continue
        const dist = haversine(a.lat, a.lng, b.lat, b.lng)
        if (dist > 50) continue

        // Same normalized name within 50m — pick better status to keep
        const rankA = STATUS_RANK[a.status] ?? 3
        const rankB = STATUS_RANK[b.status] ?? 3

        let loser, winner
        if (rankA < rankB) { winner = a; loser = b }
        else if (rankB < rankA) { winner = b; loser = a }
        else {
          // Same rank — keep alphabetically first name
          winner = a.name.localeCompare(b.name) < 0 ? a : b
          loser = winner === a ? b : a
        }

        console.log(`DUPLICATE: "${loser.name}" (${loser.status}) → delete`)
        console.log(`          "${winner.name}" (${winner.status}) → keep  [${dist.toFixed(1)}m]`)
        toDelete.add(loser.id)
      }
    }
  }

  if (toDelete.size === 0) {
    console.log('No duplicates found. Nothing to delete.')
    return
  }

  const idsToDelete = Array.from(toDelete)
  console.log(`\nDeleting ${idsToDelete.length} duplicate venues...`)

  const { error: deleteError } = await supabase
    .from('venues')
    .update({ status: 'closed' })
    .in('id', idsToDelete)

  if (deleteError) {
    console.error('Delete failed:', deleteError)
    process.exit(1)
  }

  console.log(`Done. Deleted ${idsToDelete.length} duplicates.`)
}

main()
