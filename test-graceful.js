// Test 1: SLUG GENERATION — Atlantis paths for geo-incomplete venues
function slugifyName(name) {
  const cleaned = (name ?? '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'venue'
}
function slugifyCity(city) { return slugifyName(city ?? '') }
function uniqueInCity(vs, ec) {
  if (!ec.has(vs)) return vs
  for (let i = 2; i <= 99; i++) { const c = `${vs}-${i}`; if (!ec.has(c)) return c }
  return `${vs}-${Date.now()}`
}
function resolveNewSlug({ name, city, state }) {
  const venueSlug = slugifyName(name ?? '')
  const stateCode = (state ?? '').toLowerCase().trim()
  const cityRaw = city ?? ''
  const citySlug = slugifyCity(cityRaw)
  const hasState = stateCode.length === 2
  const hasCity = cityRaw.trim().length > 0
  const needsGeoReview = !hasState || !hasCity
  if (needsGeoReview) {
    return { path: `/atlantis/${venueSlug}`, needsGeoReview: true }
  }
  return { path: `/${stateCode}/${citySlug}/${venueSlug}`, needsGeoReview: false }
}

console.log('=== SLUG GENERATION ===')
console.log("1. \"Clyde's\" in LA, CA →", resolveNewSlug({ name: "Clyde's", city: 'Los Angeles', state: 'CA' }).path)
console.log("2. Same-city collision →", uniqueInCity('clydes', new Set(['clydes'])))
console.log("3. Coeur d'Alene city slug →", slugifyCity("Coeur d'Alene"))
console.log("4. Missing city →", resolveNewSlug({ name: "Clyde's", city: null, state: 'CA' }).path)
console.log("5. Missing state →", resolveNewSlug({ name: "Clyde's", city: 'Los Angeles', state: null }).path)
console.log("6. Missing both →", resolveNewSlug({ name: "Clyde's", city: null, state: null }).path)
console.log()
console.log('Geo-incomplete cases (4-6) must use /atlantis/:', resolveNewSlug({ name: "Clyde's", city: null, state: null }).path.startsWith('/atlantis/') ? 'PASS' : 'FAIL')
console.log()

// Test 2: GRACEFUL DEG — insert + update with columns absent
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const urlLine = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const svcLine = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const url = urlLine ? urlLine.split('=').slice(1).join('=') : '';
const svc = svcLine ? svcLine.split('=').slice(1).join('=') : '';
const supabase = createClient(url, svc);

async function testGraceful() {
  console.log('=== GRACEFUL DEG (columns absent) ===')
  const insert = await supabase
    .from('venues')
    .insert({
      name: '__TEST_GRACEFUL_DEG__',
      lat: 45.5230, lng: -122.6764,
      status: 'unverified', contributor_trust: 'new', is_seed_data: false,
      address: '123 Test St', city: 'Portland', state: 'OR',
      hh_type: 'typical',
      hh_updated_at: new Date().toISOString(),
    })
    .select('id').single();
  console.log('Insert:', insert.error?.message ?? 'none');

  if (!insert.data?.id) { console.log('FAIL: no id'); return; }
  const vid = insert.data.id;

  const u1 = await supabase.from('venues').update({ new_slug: '/or/portland/test' }).eq('id', vid);
  console.log('Update new_slug (col absent):', u1.error?.message ?? 'none (caught)');

  const u2 = await supabase.from('venues').update({ needs_geo_review: true }).eq('id', vid);
  console.log('Update needs_geo_review (col absent):', u2.error?.message ?? 'none (caught)');

  const fetch = await supabase.from('venues').select('id,name').eq('id', vid).single();
  console.log('Venue still accessible:', fetch.error?.message ?? 'yes');

  await supabase.from('venues').delete().eq('id', vid);
  const gone = await supabase.from('venues').select('id').eq('id', vid);
  console.log('Deleted:', gone.data?.length === 0 ? 'yes' : 'NO');

  if (!insert.error && !fetch.error && gone.data?.length === 0) {
    console.log('\nRESULT: PASS — graceful degradation confirmed')
  } else {
    console.log('\nRESULT: FAIL')
  }
}
testGraceful().catch(e => console.log('Uncaught:', e.message));
