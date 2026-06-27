const lines = require('fs').readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

async function main() {
  // Find Solo Club
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name, slug, new_slug, address, city, state, neighborhood, lat, lng, status, hh_type, hh_time, needs_geo_review, is_seed_data')
    .ilike('name', '%Solo%')
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('=== SOLO CLUB RECORD(S) ===\n');
  venues?.forEach(v => {
    console.log(JSON.stringify(v, null, 2));
    console.log('---');
  });

  // Also search by NW Raleigh address
  const { data: byAddr } = await supabase
    .from('venues')
    .select('id, name, slug, new_slug, address, city, state, neighborhood, lat, lng, status, hh_type, needs_geo_review, is_seed_data')
    .ilike('address', '%NW Raleigh%')
    .limit(5);

  console.log('\n=== VENUES WITH "NW Raleigh" ADDRESS ===\n');
  byAddr?.forEach(v => {
    console.log(JSON.stringify(v, null, 2));
    console.log('---');
  });

  // Count Portland venues with needs_geo_review=true
  const { count } = await supabase
    .from('venues')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Portland')
    .eq('needs_geo_review', true);

  console.log(`\n=== PORTLAND: needs_geo_review=true count: ${count} ===`);

  // Count Portland venues where needs_geo_review is NOT true
  const { count: geoOk } = await supabase
    .from('venues')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Portland')
    .neq('needs_geo_review', true);

  console.log(`=== PORTLAND: needs_geo_review!=true count: ${geoOk} ===`);

  // NW District venues in Portland
  const { data: nwDist } = await supabase
    .from('venues')
    .select('id, name, neighborhood, needs_geo_review, new_slug')
    .eq('city', 'Portland')
    .ilike('neighborhood', '%Northwest%')
    .limit(50);

  console.log(`\n=== NW Portland venues (neighborhood LIKE '%Northwest%') ===`);
  console.log(`Count: ${nwDist?.length ?? 0}`);
  nwDist?.forEach(v => console.log(`  [${v.needs_geo_review ? 'NEEDS_REVIEW' : 'ok'}] ${v.name} | new_slug=${v.new_slug} | neighborhood=${v.neighborhood}`));
}

main().catch(console.error);
