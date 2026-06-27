const lines = require('fs').readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

async function main() {
  // City page query (exact replica from city page.tsx)
  const COLS = 'id, name, slug, new_slug, neighborhood, lat, lng, city, state, address, hh_type, hh_time, hh_days, hh_exclude_days, hh_start, hh_end, hh_type_2, hh_days_2, hh_exclude_days_2, hh_start_2, hh_end_2, hh_type_3, hh_days_3, hh_exclude_days_3, hh_start_3, hh_end_3, opening_min, last_verified, created_at';

  const r = await supabase
    .from('venues')
    .select(COLS)
    .eq('state', 'OR')
    .eq('city', 'Portland')
    .not('hh_type', 'is', null)
    .eq('status', 'verified');

  console.log('City page query result count:', r.data?.length ?? 0);
  console.log('Error:', r.error?.message ?? 'none');
  
  // Does Solo Club appear?
  const solo = r.data?.find(v => v.name === 'The Solo Club');
  console.log('\nSolo Club in city query result?', solo ? 'YES' : 'NO');
  if (solo) console.log(JSON.stringify(solo, null, 2));

  // What about is_seed_data venues in Portland with HH?
  const seedWithHH = await supabase
    .from('venues')
    .select('id, name, is_seed_data, city, state, neighborhood, hh_type, status')
    .eq('city', 'Portland')
    .eq('state', 'OR')
    .not('hh_type', 'is', null)
    .eq('is_seed_data', true);

  console.log('\nSeed venues in Portland with HH:', seedWithHH.data?.length ?? 0);
  seedWithHH.data?.forEach(v => console.log(`  ${v.name} | seed=${v.is_seed_data} | city=${v.city} | state=${v.state} | neighborhood=${v.neighborhood}`));

  // What does the neighborhood stats query return for NW District?
  const { data: nwStats } = await supabase
    .from('venues')
    .select('neighborhood')
    .not('neighborhood', 'is', null)
    .eq('city', 'Portland')
    .eq('state', 'OR')
    .eq('is_seed_data', false)
    .not('hh_type', 'is', null);

  console.log('\nNeighborhood stats for Portland (excluding seed):');
  const counts = {};
  for (const row of nwStats ?? []) {
    const n = row.neighborhood?.trim();
    if (!n) continue;
    counts[n] = (counts[n] ?? 0) + 1;
  }
  Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => console.log(`  ${c}  ${n}`));

  // What about WITH seed?
  const { data: nwStatsAll } = await supabase
    .from('venues')
    .select('neighborhood')
    .not('neighborhood', 'is', null)
    .eq('city', 'Portland')
    .eq('state', 'OR')
    .not('hh_type', 'is', null);

  console.log('\nNeighborhood stats for Portland (including seed):');
  const counts2 = {};
  for (const row of nwStatsAll ?? []) {
    const n = row.neighborhood?.trim();
    if (!n) continue;
    counts2[n] = (counts2[n] ?? 0) + 1;
  }
  Object.entries(counts2).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => console.log(`  ${c}  ${n}`));

  // If we include null-city/state (Solo Club has NW District neighborhood):
  const { data: allWithNeighborhood } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city, state, is_seed_data, hh_type')
    .not('neighborhood', 'is', null)
    .not('hh_type', 'is', null)
    .ilike('neighborhood', '%Northwest%');

  console.log('\nAll Portland venues with NW neighborhood (any city/state):');
  allWithNeighborhood?.forEach(v => console.log(`  [${v.is_seed_data?'seed':'real'}] ${v.name} | city=${v.city} | state=${v.state} | neighborhood=${v.neighborhood}`));
}

main().catch(console.error);
