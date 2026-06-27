const fs = require('fs');

const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');
const MAPBOX_TOKEN  = lines.find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

// ── Mirror reverseGeocodeStructured from src/lib/gps.ts ─────────────────────

async function reverseGeocodeMapbox(lat, lng) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;

  let neighborhood = null;
  for (const c of feature.context || []) {
    if (c.id?.startsWith('neighborhood.')) {
      neighborhood = c.text;
      break;
    }
  }
  return neighborhood;
}

async function main() {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, slug, lat, lng, city, state, neighborhood, address, hh_type, status')
    .eq('is_seed_data', false)
    .eq('city', 'Portland')
    .order('name');

  console.log(`Portland venues: ${venues?.length ?? 0}\n`);
  const results = [];

  for (const v of venues ?? []) {
    let neighborhood = v.neighborhood?.trim() || null;

    if (!neighborhood && v.lat && v.lng) {
      try {
        neighborhood = await reverseGeocodeMapbox(v.lat, v.lng);
      } catch (err) {
        console.log(`  ERROR ${v.name}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 60));
    }

    results.push({
      name: v.name,
      status: v.status,
      lat: v.lat,
      lng: v.lng,
      address: v.address ?? 'null',
      neighborhood,
      hadStored: !!(v.neighborhood?.trim()),
    });
  }

  // ── Distribution ───────────────────────────────────────────────────────────
  const counted = {};
  let nullCount = 0;
  results.forEach(r => {
    if (!r.neighborhood) { nullCount++; return; }
    const key = r.neighborhood.trim();
    counted[key] = (counted[key] ?? 0) + 1;
  });
  const sorted = Object.entries(counted).sort((a, b) => b[1] - a[1]);

  console.log(`\n=== NEIGHBORHOOD DISTRIBUTION ===\n`);
  sorted.forEach(([name, count]) => {
    console.log(`  ${String(count).padStart(2)}  ${'█'.repeat(count)}  ${name}`);
  });
  console.log(`  ${String(nullCount).padStart(2)}  ${'(no neighborhood)'}`);

  console.log(`\n=== RAW NEIGHBORHOOD STRINGS ===`);
  [...new Set(results.map(r => r.neighborhood).filter(Boolean))].sort().forEach(n => console.log(`  "${n}"`));

  console.log(`\n=== ALL VENUES BY NEIGHBORHOOD ===`);
  sorted.forEach(([name]) => {
    console.log(`\n  ${name}:`);
    results.filter(r => r.neighborhood?.trim() === name).forEach(r => {
      console.log(`    ${r.name}`);
    });
  });

  if (nullCount > 0) {
    console.log(`\n  (no neighborhood):`);
    results.filter(r => !r.neighborhood).forEach(r => {
      console.log(`    ${r.name} | addr="${r.address}" | lat=${r.lat?.toFixed(5)} lng=${r.lng?.toFixed(5)}`);
    });
  }

  const largest = sorted[0];
  if (largest) {
    const threshold = 15;
    console.log(`\n=== THRESHOLD ANALYSIS ===`);
    console.log(`Largest: "${largest[0]}" = ${largest[1]} venues`);
    console.log(`Threshold: ${threshold} | ${largest[1] >= threshold ? `✅ VIABLE (${largest[1] - threshold} above threshold)` : `❌ ${threshold - largest[1]} venues short`}`);
  }
}

main().catch(console.error);
