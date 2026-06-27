/**
 * Phase 3 — LIVE BACKFILL (Step 1)
 *
 * CAUTION: writes to the database. Run ONLY after confirming with Tyler.
 *
 * What it does:
 * 1. Reverse-geocodes 35 venues (null city/state, valid GPS) → populates city/state
 * 2. Computes and writes new_slug + needs_geo_review=false to ALL 39 user-created venues
 * 3. Verifies OSM seeds untouched
 *
 * Run: node phase3-backfill.js
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const urlLine = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const svcLine = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const MAPBOX_TOKEN = (() => {
  const line = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n').find(l => l.startsWith('NEXT_PUBLIC_MAPBOX_TOKEN='));
  return line ? line.split('=').slice(1).join('=') : '';
})();
const url = urlLine ? urlLine.split('=').slice(1).join('=') : '';
const svc = svcLine ? svcLine.split('=').slice(1).join('=') : '';
const supabase = createClient(url, svc);
const https = require('https');

// ── Reverse geocode ─────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeocode(lat, lng) {
  if (MAPBOX_TOKEN) {
    try {
      const data = await httpGet(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      );
      if (data?.features?.[0]) {
        const feat = data.features[0];
        let city = null, state = null;
        for (const c of feat.context || []) {
          const id = c.id || '';
          if (id.startsWith('place.')) city = c.text;
          else if (id.startsWith('region.')) {
            const code = c.short_code?.split('-').pop();
            state = code || c.text;
          }
        }
        return { city, state, source: 'mapbox' };
      }
    } catch { /* fall through */ }
  }
  return null;
}

// ── Slug helpers ─────────────────────────────────────────────────────────────
function slugifyCity(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function slugifyName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).slice(0, 6);
}

function generateVenueSlug(name) { return `${slugifyName(name)}-${shortHash(name.toLowerCase())}`; }

async function computeNewSlug(venue, supabase) {
  const hasState = !!(venue.state && venue.state.trim());
  const hasCity = !!(venue.city && venue.city.trim());
  const geoOk = hasState && hasCity;
  const venueSlug = generateVenueSlug(venue.name);

  if (!geoOk) {
    return { newSlug: `/atlantis/${venueSlug}`, needsGeoReview: true };
  }

  const stateCode = venue.state.trim().toLowerCase();
  const citySlug = slugifyCity(venue.city.trim());
  const target = `/${stateCode}/${citySlug}/${venueSlug}`;

  // Check uniqueness within city
  const { data: existing } = await supabase
    .from('venues')
    .select('id, new_slug')
    .not('new_slug', 'is', null)
    .ilike('new_slug', `/${stateCode}/${citySlug}/%`);

  const taken = (existing ?? []).filter(v => v.new_slug === target && v.id !== venue.id);
  if (taken.length === 0) return { newSlug: target, needsGeoReview: false };

  let counter = 2;
  while (true) {
    const candidate = `/${stateCode}/${citySlug}/${venueSlug}-${counter}`;
    const isTaken = (existing ?? []).some(v => v.new_slug === candidate);
    if (!isTaken) return { newSlug: candidate, needsGeoReview: false };
    counter++;
  }
}

// ── Step 1: Geo backfill ─────────────────────────────────────────────────────
async function backfillGeo(venues) {
  console.log('\n=== STEP 1: GEO BACKFILL (35 null-city/state venues) ===\n');
  const toGeo = venues.filter(v => !v.city || !v.state);

  for (let i = 0; i < toGeo.length; i++) {
    const v = toGeo[i];
    process.stdout.write(`[${i+1}/${toGeo.length}] ${v.name.padEnd(45)}... `);
    const geo = await reverseGeocode(v.lat, v.lng);
    await sleep(1100); // Nominatim fallback = 1 req/s

    if (geo?.city && geo?.state) {
      await supabase.from('venues').update({ city: geo.city, state: geo.state }).eq('id', v.id);
      console.log(`✓ → ${geo.city}, ${geo.state}`);
    } else {
      console.log(`❌ FAILED — keeping null (will route to Atlantis)`);
    }
  }
}

// ── Step 2: Re-slug ALL 39 ───────────────────────────────────────────────────
async function reslugAll(venues) {
  console.log('\n=== STEP 2: RE-SLUG (all 39 user-created venues) ===\n');

  const results = [];
  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    // Refetch fresh state/city (may have been updated by Step 1)
    const { data: fresh } = await supabase
      .from('venues')
      .select('id, name, city, state')
      .eq('id', v.id)
      .single();

    const { newSlug, needsGeoReview } = await computeNewSlug(fresh || v, supabase);

    await supabase
      .from('venues')
      .update({ new_slug: newSlug, needs_geo_review: needsGeoReview })
      .eq('id', v.id);

    const kind = needsGeoReview ? 'ATLANTIS' : 'CLEAN';
    results.push({ id: v.id, name: v.name, newSlug, kind });
    process.stdout.write(`[${i+1}/${venues.length}] ${kind.padEnd(7)}  ${newSlug}\n`);
  }
  return results;
}

// ── Verify OSM seeds untouched ────────────────────────────────────────────────
async function verifySeedsUntouched() {
  const { count } = await supabase
    .from('venues')
    .select('*', { count: 'exact', head: true })
    .eq('is_seed_data', true);
  console.log(`\nOSM seed count: ${count} (should be 59200)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== PHASE 3 LIVE BACKFILL ===\n');

  // Fetch ALL 39 user-created venues needing migration
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, lat, lng, city, state, status')
    .eq('is_seed_data', false)
    .neq('status', 'closed')
    .is('new_slug', null);

  if (!venues || venues.length === 0) {
    console.log('No venues need migration — already done!');
    return;
  }

  const nullGeo = venues.filter(v => !v.city || !v.state);
  const completeGeo = venues.filter(v => v.city && v.state);
  console.log(`Venues needing migration: ${venues.length}`);
  console.log(`  - Geo-null (Step 1 will reverse-geocode): ${nullGeo.length}`);
  console.log(`  - Geo-complete (Step 2 slug only):         ${completeGeo.length}`);

  // Step 1: backfill geo for null venues
  await backfillGeo(venues);

  // Step 2: compute and write new_slug for ALL 39
  const results = await reslugAll(venues);

  // Verify OSM seeds
  await verifySeedsUntouched();

  // Final summary
  const clean = results.filter(r => r.kind === 'CLEAN');
  const atlantis = results.filter(r => r.kind === 'ATLANTIS');
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`CLEAN (/{state}/{city}/):  ${clean.length}`);
  console.log(`ATLANTIS (geo-incomplete): ${atlantis.length}`);
  console.log(`Total migrated:            ${clean.length + atlantis.length}`);
  if (atlantis.length > 0) {
    console.log('\nAtlantis venues:');
    atlantis.forEach(r => console.log(`  ${r.name} → ${r.newSlug}`));
  }

  fs.writeFileSync('/Users/livingroom/.openclaw/workspace/pourlist/phase3-manifest.json', JSON.stringify(results, null, 2));
  console.log('\nManifest written to phase3-manifest.json');
}

main().catch(e => console.error('ERROR:', e.message));
