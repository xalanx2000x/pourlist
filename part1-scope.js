const lines = require('fs').readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const raw = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const SUPABASE_SVC = raw.split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

async function main() {
  console.log('=== PART 1: GHOST POPULATION SCOPE ===\n');

  const { data: allGhosts, error: gErr } = await supabase
    .from('venues')
    .select('id, name, address, city, state, neighborhood, lat, lng, status, hh_type, is_seed_data')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .or(`city.is.null,state.is.null`)
    .limit(2000);

  if (gErr) { console.error('Ghost query error:', gErr); return; }

  const total = allGhosts?.length ?? 0;
  console.log(`TOTAL venues with coords + null city OR null state: ${total}\n`);

  const graduated = [];
  const dormant = [];

  for (const v of allGhosts ?? []) {
    const isGraduated = v.status === 'verified' || v.hh_type !== null;
    if (isGraduated) graduated.push(v);
    else dormant.push(v);
  }

  console.log(`  Graduated (verified OR has HH): ${graduated.length}`);
  console.log(`  Dormant (unverified, no HH):   ${dormant.length}\n`);

  const dormantUnknown = dormant.filter(v => v.address?.toLowerCase().trim() === 'unknown');
  const dormantOther   = dormant.filter(v => v.address?.toLowerCase().trim() !== 'unknown');
  console.log(`  Of dormant:`);
  console.log(`    address = "Unknown": ${dormantUnknown.length}`);
  console.log(`    address != "Unknown": ${dormantOther.length}\n`);

  console.log('=== GRADUATED GHOSTS (Solo Club class) ===\n');
  graduated.forEach(v => {
    console.log(`  [${v.status}] [seed=${v.is_seed_data}] ${v.name}`);
    console.log(`    address: "${v.address}"`);
    console.log(`    city=${v.city ?? 'null'} state=${v.state ?? 'null'} neighborhood=${v.neighborhood ?? 'null'}`);
    console.log(`    lat=${v.lat?.toFixed(5)} lng=${v.lng?.toFixed(5)}`);
    console.log(`    hh_type=${v.hh_type ?? 'null'}`);
    console.log();
  });

  console.log('=== SAMPLE DORMANT (address="Unknown") ===');
  dormantUnknown.slice(0, 5).forEach(v => {
    console.log(`  [${v.status}] ${v.name} | addr="${v.address}" | lat=${v.lat?.toFixed(5)} lng=${v.lng?.toFixed(5)}`);
  });
  console.log(`  ... (total: ${dormantUnknown.length})`);

  console.log('\n=== SAMPLE DORMANT (address!="Unknown") ===');
  dormantOther.slice(0, 5).forEach(v => {
    console.log(`  [${v.status}] ${v.name} | addr="${v.address}" | lat=${v.lat?.toFixed(5)} lng=${v.lng?.toFixed(5)}`);
  });
  console.log(`  ... (total: ${dormantOther.length})`);

  const GHOST_COUNT = total;
  const GRADUATED_COUNT = graduated.length;
  const MAPBOX_BATCH_COST_PER_1K = 0.0004;

  console.log('\n=== MAPBOX COST/RATE ESTIMATE ===');
  console.log(`Graduated ghosts to geocode: ${GRADUATED_COUNT}`);
  console.log(`  Batch geocoding cost: ~$${(GRADUATED_COUNT / 1000) * MAPBOX_BATCH_COST_PER_1K.toFixed(4)}`);
  console.log(`All ghosts to geocode: ${GHOST_COUNT}`);
  console.log(`  Batch geocoding cost: ~$${(GHOST_COUNT / 1000) * MAPBOX_BATCH_COST_PER_1K.toFixed(4)}`);
  console.log(`Mapbox free tier: 100k requests/month`);
  console.log(`Rate limit: 600 requests/minute (batch), 100/minute (single)`);

  const uniqueCoords = new Set(graduated.map(v => `${v.lat?.toFixed(5)},${v.lng?.toFixed(5)}`));
  console.log(`\nUnique coord pairs in graduated: ${uniqueCoords.size} (out of ${GRADUATED_COUNT})`);
}

main().catch(console.error);
