/**
 * Phase 3 — Step 1: Backfill city/state for seed-promoted venues
 * that have GPS but null city/state.
 *
 * These venues were OSM seeds confirmed by users via submit-venue
 * with seedVenueId — but the promotion path never ran reverse geocode.
 *
 * This script:
 * 1. Finds all user-created venues with null city OR null state but valid GPS
 * 2. Reverse-geocodes each one (Mapbox → Nominatim fallback)
 * 3. Updates city/state in the DB
 * 4. Produces a JSON manifest of what was updated
 *
 * Tyler: run this ONCE before the re-slug migration.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const urlLine = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const svcLine = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const url = urlLine ? urlLine.split('=').slice(1).join('=') : '';
const svc = svcLine ? svcLine.split('=').slice(1).join('=') : '';
const supabase = createClient(url, svc);
const https = require('https');

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';

// ── Reverse geocode ──────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function reverseGeocode(lat, lng) {
  // Mapbox
  if (MAPBOX_TOKEN) {
    try {
      const data = await httpGet(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      );
      if (data?.features?.[0]) return parseMapboxFeature(data.features[0]);
    } catch { /* fall through */ }
  }

  // Nominatim fallback
  try {
    const data = await httpGet(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    if (data) return parseNominatim(data);
  } catch { /* both failed */ }

  return null;
}

function parseMapboxFeature(feature) {
  let city = null, state = null, country = null, zip = null, neighborhood = null;
  for (const c of feature.context || []) {
    const id = c.id || '';
    if (id.startsWith('place.')) city = c.text;
    else if (id.startsWith('region.')) {
      const code = c.short_code?.split('-').pop();
      state = code || c.text;
    } else if (id.startsWith('neighborhood.')) neighborhood = c.text;
    else if (id.startsWith('country.')) country = c.short_code || c.text;
    else if (id.startsWith('postcode.')) zip = c.text;
  }
  return { city, state, country, zip, neighborhood, fullAddress: feature.place_name || '' };
}

function parseNominatim(data) {
  const addr = data.address || {};
  let city = addr.city || addr.town || addr.village || addr.municipality || null;
  let state = addr.state ? addr.state.split('-').pop() : null;
  let country = addr.country_code?.toUpperCase() || null;
  let zip = addr.postcode || null;
  return { city, state, country, zip, neighborhood: addr.neighbourhood || null, fullAddress: data.display_name || '' };
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Phase 3 Step 1: Backfill city/state from GPS ===\n');

  // Load venues with GPS but missing city OR state
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, lat, lng, city, state')
    .eq('is_seed_data', false)
    .neq('status', 'closed')
    .not('new_slug', 'is', null)
    .is('new_slug', null)  // only those still needing slug
    .or(`city.is.null,state.is.null`)
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  // Actually let's just get ALL user-created venues missing city/state regardless of new_slug
  const { data: all } = await supabase
    .from('venues')
    .select('id, name, lat, lng, city, state')
    .eq('is_seed_data', false)
    .neq('status', 'closed')
    .is('new_slug', null);

  const toGeo = (all || []).filter(v => v.lat != null && v.lng != null && (!v.city || !v.state));

  console.log(`Found ${toGeo.length} venues with GPS but missing city/state\n`);

  const manifest = [];

  for (const v of toGeo) {
    process.stdout.write(`  Geocoding ${v.name} (${v.lat}, ${v.lng})... `);
    const geo = await reverseGeocode(v.lat, v.lng);
    if (!geo) {
      console.log('FAILED — both Mapbox and Nominatim returned null');
      manifest.push({ id: v.id, name: v.name, lat: v.lat, lng: v.lng, success: false });
      continue;
    }
    console.log(`→ ${geo.city}, ${geo.state}`);

    await supabase
      .from('venues')
      .update({ city: geo.city, state: geo.state })
      .eq('id', v.id);

    manifest.push({ id: v.id, name: v.name, lat: v.lat, lng: v.lng, city: geo.city, state: geo.state });
  }

  fs.writeFileSync('/Users/livingroom/.openclaw/workspace/pourlist/backfill-manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest to backfill-manifest.json`);

  const succeeded = manifest.filter(m => m.success !== false);
  const failed = manifest.filter(m => m.success === false);
  console.log(`\nSucceeded: ${succeeded.length} | Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log('Failed venues (Atlantis fallback):');
    failed.forEach(v => console.log(`  ${v.name} (${v.id})`));
  }
}

main().catch(e => console.error('ERROR:', e.message));
