const fs = require('fs');

const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');
const MAPBOX_TOKEN  = lines.find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

// Use forward geocoding to get neighborhood from address
async function getNeighborhoodForward(address, city = 'Portland', state = 'OR') {
  if (!address || address.trim() === '' || address === 'Unknown') return null;
  const query = encodeURIComponent(`${address}, ${city}, ${state}`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&types=neighborhood&dedicated=true&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const features = data.features ?? [];
  if (features.length === 0) return null;
  return features[0].text ?? null;
}

// Also try reverse geocode with v5 API
async function getNeighborhoodReverse(lng, lat) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=neighborhood&dedicated=true&limit=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const features = data.features ?? [];
  if (features.length === 0) return { neighborhood: null, raw: [] };
  return {
    neighborhood: features[0].text ?? null,
    raw: features.map(f => ({ text: f.text, id: f.id, place_type: f.place_type, relevance: f.relevance })),
  };
}

async function main() {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, slug, new_slug, lat, lng, city, state, neighborhood, address, hh_type, status')
    .eq('is_seed_data', false)
    .eq('city', 'Portland')
    .order('name');

  console.log(`Portland venues: ${venues.length}\n`);

  const results = [];

  for (const v of venues) {
    // First try forward geocode from stored address
    let neighborhood = null;
    let method = null;

    if (v.address && v.address.trim() !== '' && v.address !== 'Unknown') {
      const n = await getNeighborhoodForward(v.address);
      if (n) {
        neighborhood = n;
        method = 'forward';
      }
    }

    // Fall back to reverse geocode from coords
    if (!neighborhood && v.lat && v.lng) {
      try {
        const r = await getNeighborhoodReverse(v.lng, v.lat);
        neighborhood = r.neighborhood;
        method = method ?? (r.neighborhood ? 'reverse' : null);
        if (v.name === 'Urban German Wursthaus') {
          console.log(`DEBUG ${v.name}: forward=${v.address}, reverse raw:`, JSON.stringify(r));
        }
      } catch (err) {
        console.log(`  ${v.name}: reverse error: ${err.message}`);
      }
    } else if (!neighborhood) {
      method = method ?? 'no_addr_no_coords';
    }

    results.push({
      name: v.name,
      status: v.status,
      lat: v.lat,
      lng: v.lng,
      address: v.address ?? 'null',
      neighborhood,
      method,
    });

    await new Promise(r => setTimeout(r, 80));
  }

  // Distribution
  const counted = {};
  let nullCount = 0;
  results.forEach(r => {
    if (!r.neighborhood || r.neighborhood.trim() === '') {
      nullCount++;
      return;
    }
    const key = r.neighborhood.trim();
    counted[key] = (counted[key] ?? 0) + 1;
  });

  const sorted = Object.entries(counted).sort((a, b) => b[1] - a[1]);

  console.log(`\n=== NEIGHBORHOOD DISTRIBUTION ===\n`);
  sorted.forEach(([name, count]) => {
    const bar = '█'.repeat(count);
    console.log(`  ${name.padEnd(35)} ${String(count).padStart(2)}  ${bar}`);
  });
  if (nullCount > 0) {
    console.log(`  ${'(no neighborhood)'.padEnd(35)} ${String(nullCount).padStart(2)}`);
  }

  console.log(`\n=== RAW NEIGHBORHOOD STRINGS ===`);
  const uniqueRaw = [...new Set(results.map(r => r.neighborhood).filter(Boolean).map(n => n.trim()))].sort();
  uniqueRaw.forEach(n => console.log(`  "${n}"`));

  console.log(`\n=== VENUES WITH NO NEIGHBORHOOD ===`);
  results.filter(r => !r.neighborhood).forEach(r => {
    console.log(`  ${r.name} | addr="${r.address}" | lat=${r.lat} | method=${r.method}`);
  });

  console.log(`\n=== ALL VENUES WITH NEIGHBORHOOD ===`);
  results.filter(r => r.neighborhood).forEach(r => {
    console.log(`  ${r.neighborhood.padEnd(30)} ${r.name}`);
  });

  if (sorted.length > 0) {
    const largest = sorted[0];
    const threshold = 15;
    console.log(`\n=== THRESHOLD ANALYSIS ===`);
    console.log(`Largest: "${largest[0]}" = ${largest[1]} venues`);
    console.log(`Threshold: ${threshold} | ${largest[1] >= threshold ? 'ABOVE — viable now' : `${threshold - largest[1]} venues short`}`);
  }
}

main().catch(console.error);
