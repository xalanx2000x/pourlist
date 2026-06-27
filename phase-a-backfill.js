const fs = require('fs');

const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');
const MAPBOX_TOKEN  = lines.find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN=')).split('=').slice(1).join('=');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

async function reverseGeocodeMapbox(lat, lng) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  for (const c of feature.context || []) {
    if (c.id?.startsWith('neighborhood.')) return c.text;
  }
  return null;
}

async function main() {
  // Get all Portland venues without a stored neighborhood
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name, neighborhood, lat, lng, city, state, is_seed_data')
    .eq('is_seed_data', false)
    .or(`city.eq.Portland,city.eq.portland`);

  if (error) { console.log('DB error:', error.message); return; }

  const toUpdate = (venues ?? []).filter(v => !v.neighborhood || !v.neighborhood.trim());

  console.log(`Portland venues needing neighborhood: ${toUpdate.length}`);
  console.log('');

  const updates = [];
  for (const v of toUpdate) {
    if (!v.lat || !v.lng) {
      console.log(`  SKIP (no coords): ${v.name}`);
      updates.push({ id: v.id, name: v.name, neighborhood: null, method: 'no_coords' });
      continue;
    }

    const neighborhood = await reverseGeocodeMapbox(v.lat, v.lng);
    console.log(`  ${neighborhood ? '✅' : '⚠️'} ${v.name.padEnd(45)} → "${neighborhood ?? 'null'}"`);

    updates.push({ id: v.id, name: v.name, neighborhood, method: neighborhood ? 'mapbox' : 'not_found' });

    // Rate-limit Mapbox: 60 req/sec, stay at ~40
    await new Promise(r => setTimeout(r, 30));
  }

  // Batch update: one RPC call or individual updates
  console.log(`\nUpdating ${updates.filter(u => u.neighborhood).length} venues...`);
  let updated = 0;
  let failed = 0;

  for (const u of updates) {
    if (!u.neighborhood) continue;
    const { error } = await supabase
      .from('venues')
      .update({ neighborhood: u.neighborhood })
      .eq('id', u.id);
    if (error) {
      console.log(`  ❌ ${u.name}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`\n✅ Updated: ${updated} | ❌ Failed: ${failed}`);

  // Final distribution
  const { data: allPortland } = await supabase
    .from('venues')
    .select('id, name, neighborhood')
    .eq('is_seed_data', false)
    .or(`city.eq.Portland,city.eq.portland`);

  const counted = {};
  let nullCount = 0;
  (allPortland ?? []).forEach(v => {
    const n = v.neighborhood?.trim();
    if (!n) { nullCount++; return; }
    counted[n] = (counted[n] ?? 0) + 1;
  });
  const sorted = Object.entries(counted).sort((a, b) => b[1] - a[1]);

  console.log(`\n=== FINAL DISTRIBUTION (${allPortland?.length ?? 0} Portland venues) ===`);
  sorted.forEach(([n, c]) => console.log(`  ${String(c).padStart(2)}  ${n}`));
  if (nullCount > 0) console.log(`  ${String(nullCount).padStart(2)}  (no neighborhood)`);

  console.log(`\nNW District count: ${counted['Northwest District'] ?? 0} (threshold: 15)`);
}

main().catch(console.error);
