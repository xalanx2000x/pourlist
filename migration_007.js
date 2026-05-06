/**
 * Migration 007: Reset OSM-seeded venues to unverified via REST API
 * (No local Docker needed — uses Supabase REST API directly)
 */

const BASE_URL = 'https://cuzkquenafzebdqbuwfk.supabase.co'
const headers = {
  'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1emtxdWVuYWZ6ZWJkcWJ1d2ZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ0MTc1MCwiZXhwIjoyMDkxMDE3NzUwfQ.LxDCSHOZ_FfOQqnH37ycLGDrwb8Qjs30STZYliN4Hl8`,
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1emtxdWVuYWZ6ZWJkcWJ1d2ZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ0MTc1MCwiZXhwIjoyMDkxMDE3NzUwfQ.LxDCSHOZ_FfOQqnH37ycLGDrwb8Qjs30STZYliN4Hl8',
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
}

async function executeSQL(sql) {
  const res = await fetch(`${BASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sql })
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

// Check if exec_sql RPC exists
async function main() {
  console.log('=== Migration 007: Reset anonymous-Trust venues to unverified ===\n')

  // Step 1: Count before
  console.log('--- Step 1: Before counts ---')
  const countRes = await fetch(
    `${BASE_URL}/rest/v1/venues?select=status,contributor_trust,count(*)&contributor_trust=eq.anonymous&group=status,contributor_trust`,
    { headers }
  )
  console.log('Status:', countRes.status)
  const beforeData = await countRes.json()
  console.log('Raw response:', JSON.stringify(beforeData))

  // Step 2: Reset anonymous venues to unverified
  console.log('\n--- Step 2: Resetting anonymous venues to unverified ---')
  
  // Count how many to reset first
  const toResetRes = await fetch(
    `${BASE_URL}/rest/v1/venues?contributor_trust=eq.anonymous&status=neq.unverified&select=id&limit=1`,
    { headers }
  )
  console.log('toResetRes status:', toResetRes.status)
  
  // Do the reset
  const resetRes = await fetch(
    `${BASE_URL}/rest/v1/venues?contributor_trust=eq.anonymous&status=neq.unverified`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'unverified' })
    }
  )
  console.log('Reset status:', resetRes.status, resetRes.statusText)
  console.log('Reset response:', await resetRes.text())
}

main().catch(console.error)