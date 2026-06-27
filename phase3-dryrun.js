/**
 * Phase 3 — Geocode DRY RUN
 * For each of the 39 venues with GPS but null city/state:
 *   → attempt reverse geocode (Mapbox → Nominatim)
 *   → show what city/state would be written
 *   → DO NOT write anything to the DB
 *
 * Run: node phase3-dryrun.js
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
function httpGet(url, tokenReplace) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (tokenReplace) body = body.replace(/pk\.\S+/g, '***');
          resolve(parsed);
        } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeocode(lat, lng) {
  // Mapbox
  if (MAPBOX_TOKEN) {
    try {
      const data = await httpGet(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      );
      if (data?.features?.[0]) {
        const feat = data.features[0];
        let city = null, state = null, country = null;
        for (const c of feat.context || []) {
          const id = c.id || '';
          if (id.startsWith('place.')) city = c.text;
          else if (id.startsWith('region.')) {
            const code = c.short_code?.split('-').pop();
            state = code || c.text;
          } else if (id.startsWith('country.')) country = c.short_code || c.text;
        }
        return { city, state, country, source: 'mapbox' };
      }
    } catch { /* fall through */ }
  }

  // Nominatim (rate-limit: 1 req/s)
  try {
    const data = await httpGet(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    if (data?.address) {
      const addr = data.address;
      const city = addr.city || addr.town || addr.village || addr.municipality || null;
      const state = addr.state ? addr.state.split('-').pop() : null;
      const country = addr.country_code?.toUpperCase() || null;
      return { city, state, country, source: 'nominatim' };
    }
  } catch { /* both failed */ }

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

function venueSlug(name) { return `${slugifyName(name)}-${shortHash(name.toLowerCase())}`; }

function wouldBeClean(geo) {
  if (!geo || !geo.city || !geo.state) return false;
  return !!(geo.city.trim() && geo.state.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('MAPBOX_TOKEN set:', MAPBOX_TOKEN ? 'YES (***)' : 'NO — will use Nominatim only\n');

  // Fetch the 39 venues needing geo
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, lat, lng, city, state, status')
    .eq('is_seed_data', false)
    .neq('status', 'closed')
    .is('new_slug', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  const toGeo = (venues || []).filter(v => !v.city || !v.state);
  console.log(`Venues needing geo: ${toGeo.length}\n`);

  const results = [];
  let clean = 0, atlantis = 0;

  for (const v of toGeo) {
    process.stdout.write(`[${toGeo.indexOf(v)+1}/${toGeo.length}] ${v.name.padEnd(45)} (${v.lat.toFixed(5)}, ${v.lng.toFixed(5)})... `);
    const geo = await reverseGeocode(v.lat, v.lng);
    await sleep(1100); // Nominatim 1 req/s rate limit

    if (!geo || !geo.city || !geo.state) {
      const slug = venueSlug(v.name);
      results.push({ id: v.id, name: v.name, lat: v.lat, lng: v.lng, geo: null, newSlug: `/atlantis/${slug}` });
      atlantis++;
      console.log(`❌ FAIL → Atlantis (city="${geo?.city}" state="${geo?.state}")`);
    } else {
      const stateCode = geo.state.toLowerCase();
      const citySlug = slugifyCity(geo.city);
      const slug = venueSlug(v.name);
      const newSlug = `/${stateCode}/${citySlug}/${slug}`;
      results.push({ id: v.id, name: v.name, lat: v.lat, lng: v.lng, geo, newSlug });
      clean++;
      console.log(`✓ ${geo.city}, ${geo.state} → ${newSlug} [${geo.source}]`);
    }
  }

  console.log('\n=== DRY RUN SUMMARY ===');
  console.log(`Clean (/{state}/{city}/):  ${clean}`);
  console.log(`Atlantis (no geo resolve): ${atlantis}`);
  console.log(`Total:                     ${clean + atlantis}`);

  const pct = atlantis > 0 ? Math.round(atlantis / (clean + atlantis) * 100) : 0;
  console.log(`\nAtlantis rate: ${pct}%`);

  if (atlantis > 0) {
    console.log('\n=== ATLANTIS VENUES (geocode failed) ===');
    results.filter(r => !wouldBeClean(r.geo)).forEach(r => {
      console.log(`  ${r.name}`);
      console.log(`    lat=${r.lat} lng=${r.lng}`);
      console.log(`    geo=${JSON.stringify(r.geo)}`);
      console.log(`    → ${r.newSlug}`);
    });
  }

  if (clean > 0) {
    console.log('\n=== CLEAN VENUES ===');
    results.filter(r => wouldBeClean(r.geo)).forEach(r => {
      console.log(`  /or/portland/${venueSlug(r.name)}  ← ${r.name} (${r.geo?.city}, ${r.geo?.state})`);
    });
  }

  fs.writeFileSync('/Users/livingroom/.openclaw/workspace/pourlist/phase3-dryrun-results.json', JSON.stringify(results, null, 2));
  console.log(`\nWrote full results to phase3-dryrun-results.json`);
}

main().catch(e => console.error('ERROR:', e.message));
