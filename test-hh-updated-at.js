const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1] ?? '';
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1] ?? '';
const supabase = createClient(url, svc);

async function test() {
  // Try inserting with hh_updated_at when the column doesn't exist
  const res = await supabase
    .from('venues')
    .insert({
      name: '__TEST_STALE_CHECK__',
      lat: 45.5230,
      lng: -122.6764,
      status: 'unverified',
      contributor_trust: 'new',
      is_seed_data: false,
      hh_updated_at: new Date().toISOString(),  // column doesn't exist yet
      hh_type: 'typical',
      hh_days: [1,2,3,4,5],
      hh_start: 1600,
      hh_end: 1900,
    })
    .select('id, name, hh_updated_at')
    .single();

  console.log('error:', res.error?.message ?? 'none');
  console.log('data:', JSON.stringify(res.data));

  // Clean up test record
  if (res.data && res.data.id) {
    await supabase.from('venues').delete().eq('id', res.data.id);
    console.log('(cleaned up test record)');
  }
}
test().catch(e => console.log('uncaught:', e.message));
