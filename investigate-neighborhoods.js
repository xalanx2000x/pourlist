const fs = require('fs');

const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const SUPABASE_URL = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=');
const SUPABASE_SVC  = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=');
const MAPBOX_TOKEN  = lines.find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN=')).split('=').slice(1).join('=');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

// ── Mapbox reverse geocode ───────────────────────────────────────────────────

async function reverseGeocodeMapbox(lng, lat) {
  const url = `https://api.mapbox.com/v4/geocode/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=neighborhood,locality&dedicated=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
  const data = await res.json();
  const features = data.features ?? [];

  // Try neighborhood first, then locality
  const neighborhood = features.find(f => f.id.startsWith('neighborhood'))?.text ?? null;
  const locality      = features.find(f => f.id.startsWith('locality'))?.text ?? null;

  return { neighborhood: neighborhood ?? locality ?? null, raw: features.map(f => ({ id: f.id, text: f.text, place_type: f.place_type, relevance: f.relevance })) };
}

// ── Load all user-created Portland venues ────────────────────────────────────

async function main() {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, slug, new_slug, lat, lng, city, state, neighborhood, address, hh_type, status')
    .eq('is_seed_data', false)
    .eq('city', 'Portland')
    .order('name');

  if (!venues || venues.length === 0) {
    console.log('No Portland venues found');
    return;
  }

  console.log(`Portland venues: ${venues.length}\n`);

  const withStoredNeighborhood  = venues.filter(v => v.neighborhood && v.neighborhood.trim() !== '');
  const withoutStoredNeighborhood = venues.filter(v => !v.neighborhood || v.neighborhood.trim() === '');

  console.log(`=== STORED NEIGHBORHOOD FIELD ===`);
  console.log(`Has neighborhood: ${withStoredNeighborhood.length}`);
  console.log(`Missing/null neighborhood: ${withoutStoredNeighborhood.length}\n`);

  // Look up missing via Mapbox
  console.log(`=== MAPBOX LOOKUP (venues without stored neighborhood) ===\n`);
  const lookupResults = [];

  for (const v of withoutStoredNeighborhood) {
    if (!v.lat || !v.lng) {
      lookupResults.push({ id: v.id, name: v.name, status: v.status, lat: v.lat, lng: v.lng, neighborhood: null, lookup_status: 'no_coords' });
      continue;
    }
    try {
      const result = await reverseGeocodeMapbox(v.lng, v.lat);
      lookupResults.push({
        id: v.id,
        name: v.name,
        status: v.status,
        lat: v.lat,
        lng: v.lng,
        neighborhood: result.neighborhood,
        raw: result.raw,
        lookup_status: 'ok',
      });
    } catch (err) {
      lookupResults.push({ id: v.id, name: v.name, status: v.status, lat: v.lat, lng: v.lng, neighborhood: null, lookup_status: `error: ${err.message}` });
    }
    // Brief pause to respect rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  // Print raw lookup results
  lookupResults.forEach(v => {
    console.log(`  ${v.name} (${v.status})`);
    console.log(`    lat/lng: ${v.lat}, ${v.lng}`);
    console.log(`    neighborhood: ${v.neighborhood ?? 'null'}`);
    console.log(`    raw features:`, JSON.stringify(v.raw));
    console.log();
  });

  // Build distribution from ALL venues (stored + looked-up)
  const allNeighborhoods = venues.map(v => {
    const lookedUp = lookupResults.find(r => r.id === v.id);
    return lookedUp?.neighborhood ?? v.neighborhood ?? null;
  });

  const counted = {};
  let nullCount = 0;
  allNeighborhoods.forEach(n => {
    if (!n || n.trim() === '') { nullCount++; return; }
    const key = n.trim();
    counted[key] = (counted[key] ?? 0) + 1;
  });

  const sorted = Object.entries(counted).sort((a, b) => b[1] - a[1]);

  console.log(`\n=== NEIGHBORHOOD DISTRIBUTION (${venues.length} Portland venues) ===`);
  console.log(`(includes stored + Mapbox-looked-up neighborhoods)\n`);
  sorted.forEach(([name, count]) => {
    const bar = '█'.repeat(count);
    console.log(`  ${name.padEnd(35)} ${String(count).padStart(2)}  ${bar}`);
  });
  console.log(`  ${'(no neighborhood)'.padEnd(35)} ${String(nullCount).padStart(2)}`);

  // Analyze raw strings
  console.log(`\n=== RAW NEIGHBORHOOD STRINGS (unique values) ===`);
  const uniqueRaw = [...new Set(allNeighborhoods.filter(Boolean).map(n => n.trim()))].sort();
  uniqueRaw.forEach(n => console.log(`  "${n}"`));

  // Correlation check: venues with no neighborhood
  const noNeighborhoodVenues = venues.filter((v, i) => {
    const lookedUp = lookupResults.find(r => r.id === v.id);
    const n = lookedUp?.neighborhood ?? v.neighborhood ?? null;
    return !n || n.trim() === '';
  });
  console.log(`\n=== VENUES WITH NO NEIGHBORHOOD ===`);
  noNeighborhoodVenues.forEach(v => {
    console.log(`  ${v.name} | status=${v.status} | lat=${v.lat} | lng=${v.lng} | addr=${v.address ?? 'null'}`);
  });

  // Threshold analysis
  if (sorted.length > 0) {
    const largest = sorted[0];
    const threshold = 15;
    console.log(`\n=== THRESHOLD ANALYSIS ===`);
    console.log(`Largest neighborhood: "${largest[0]}" with ${largest[1]} venues`);
    console.log(`Threshold: ${threshold}`);
    if (largest[1] >= threshold) {
      console.log(`${largest[1] - threshold} venues above threshold — can build NOW`);
    } else {
      console.log(`${threshold - largest[1]} venues short of threshold`);
      const neededForSecond = sorted.length > 1 ? sorted[1][1] : 0;
      console.log(`Second largest: "${sorted[1]?.[0]}" has ${neededForSecond} venues`);
    }
  }
}

main().catch(console.error);
