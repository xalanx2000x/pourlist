const lines = require('fs').readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

// Reverse geocode Solo Club's coords to find neighborhood
async function reverseGeocode(lat, lng) {
  const MAPBOX_TOKEN = lines.find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN=')).split('=').slice(1).join('=');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  let neighborhood = null, city = null, state = null;
  for (const c of feature.context || []) {
    if (c.id?.startsWith('neighborhood.')) neighborhood = c.text;
    if (c.id?.startsWith('place.')) city = c.text;
    if (c.id?.startsWith('region.')) state = c.text;
  }
  return { neighborhood, city, state, full: feature.place_name };
}

async function main() {
  // Get full Solo Club record including address_autofilled
  const { data: venues } = await supabase
    .from('venues')
    .select('*')
    .ilike('name', '%Solo Club%')
    .limit(3);

  console.log('=== FULL SOLO CLUB RECORD ===');
  venues?.forEach(v => {
    if (v.name !== 'The Solo Club') return;
    console.log(JSON.stringify(v, null, 2));
  });

  // Reverse geocode Solo Club's coords
  const solo = venues?.find(v => v.name === 'The Solo Club');
  if (solo?.lat && solo?.lng) {
    console.log('\n=== REVERSE GEOCODE OF SOLO CLUB COORDS ===');
    const geo = await reverseGeocode(solo.lat, solo.lng);
    console.log(JSON.stringify(geo, null, 2));
  }

  // Now check: what does getNeighborhoodStats return for Portland?
  // (simulate what the city page does)
  console.log('\n=== NEIGHBORHOOD COUNTS (simulated) ===');
  const { data: allPortland } = await supabase
    .from('venues')
    .select('neighborhood')
    .eq('city', 'Portland')
    .eq('state', 'OR')
    .not('neighborhood', 'is', null)
    .not('hh_type', 'is', null)
    .eq('is_seed_data', false);

  const counts = {};
  for (const row of allPortland ?? []) {
    const n = row.neighborhood?.trim();
    if (!n) continue;
    counts[n] = (counts[n] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([n, c]) => console.log(`  ${c}  ${n}`));

  // What about including seed_data?
  console.log('\n=== NEIGHBORHOOD COUNTS (including seed_data) ===');
  const { data: allPortlandSeed } = await supabase
    .from('venues')
    .select('neighborhood')
    .eq('city', 'Portland')
    .eq('state', 'OR')
    .not('neighborhood', 'is', null)
    .not('hh_type', 'is', null);

  const counts2 = {};
  for (const row of allPortlandSeed ?? []) {
    const n = row.neighborhood?.trim();
    if (!n) continue;
    counts2[n] = (counts2[n] ?? 0) + 1;
  }
  const sorted2 = Object.entries(counts2).sort((a, b) => b[1] - a[1]);
  sorted2.forEach(([n, c]) => console.log(`  ${c}  ${n}`));

  // What neighborhoods does Solo Club belong to?
  if (solo?.lat && solo?.lng) {
    const geo = await reverseGeocode(solo.lat, solo.lng);
    if (geo?.neighborhood) {
      console.log(`\n=== IF SOLO CLUB HAD neighborhood="${geo.neighborhood}", COUNT WOULD BE ===`);
      const currentCount = counts2[geo.neighborhood] ?? 0;
      console.log(`  "${geo.neighborhood}": ${currentCount} → ${currentCount + 1} (with Solo Club)`);
    }
  }
}

main().catch(console.error);
