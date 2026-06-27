const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

async function main() {
  // Check if neighborhood column exists and what values are in it
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city, state, is_seed_data, lat, lng')
    .eq('is_seed_data', false)
    .eq('city', 'Portland')
    .order('name');

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }

  const withNeighborhood = data?.filter(v => v.neighborhood && v.neighborhood.trim()) || [];
  const withoutNeighborhood = data?.filter(v => !v.neighborhood || !v.neighborhood.trim()) || [];

  console.log(`Portland venues: ${data?.length ?? 0}`);
  console.log(`With neighborhood stored: ${withNeighborhood.length}`);
  console.log(`Without neighborhood: ${withoutNeighborhood.length}`);

  if (withoutNeighborhood.length > 0) {
    console.log('\nVenues needing neighborhood population:');
    withoutNeighborhood.forEach(v => {
      console.log(`  ${v.name} | lat=${v.lat} | lng=${v.lng} | neighborhood="${v.neighborhood}"`);
    });
  }

  // Show current distribution from what's already stored
  const counted = {};
  data?.forEach(v => {
    const n = v.neighborhood?.trim() || null;
    if (!n) return;
    counted[n] = (counted[n] ?? 0) + 1;
  });
  const sorted = Object.entries(counted).sort((a, b) => b[1] - a[1]);
  console.log('\nCurrent stored distribution:');
  sorted.forEach(([n, c]) => console.log(`  ${c}  ${n}`));
}

main().catch(console.error);
