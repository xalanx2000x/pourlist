/**
 * Check if Atlantis-flagged venues have lat/lng for backfill
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const urlLine = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const svcLine = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const url = urlLine ? urlLine.split('=').slice(1).join('=') : '';
const svc = svcLine ? svcLine.split('=').slice(1).join('=') : '';
const supabase = createClient(url, svc);

async function main() {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, state, city, lat, lng, status, address, is_seed_data')
    .eq('is_seed_data', false)
    .neq('status', 'closed')
    .is('new_slug', null);

  console.log(`${venues.length} user-created venues missing new_slug\n`);

  let hasGps = 0;
  let noGps = 0;
  let hasAddress = 0;

  for (const v of venues) {
    const hasCoords = v.lat != null && v.lng != null;
    const hasAddr = !!(v.address && v.address.trim());
    if (hasCoords) hasGps++;
    else noGps++;
    if (hasAddr) hasAddress++;
    console.log(`  [${hasCoords ? 'GPS' : 'NO_GPS'}] [${hasAddr ? 'ADDR' : 'NO_ADDR'}]  ${v.name}`);
    console.log(`      lat=${v.lat} lng=${v.lng}  address="${v.address}"`);
  }

  console.log(`\nSummary:`);
  console.log(`  Has GPS coordinates: ${hasGps} (can backfill city/state via reverse geocode)`);
  console.log(`  No GPS:             ${noGps} (geo-incomplete, must stay Atlantis)`);
  console.log(`  Has address string: ${hasAddress}`);
  console.log(`\n  → If we reverse-geocode the ${hasGps} venues with GPS, they may move CLEAN → Atlantis`);
  console.log(`  → Only ${noGps} venues are truly geo-incomplete`);
}
main().catch(e => console.error('ERROR:', e.message));
