const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const lines = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/.env.local', 'utf8').split('\n');
const urlLine = lines.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='));
const svcLine = lines.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
const url = urlLine ? urlLine.split('=').slice(1).join('=') : '';
const svc = svcLine ? svcLine.split('=').slice(1).join('=') : '';
const supabase = createClient(url, svc);

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
function uuidShort(id) {
  return id.replace(/-/g, '').slice(0, 6)
}

async function main() {
  const { data } = await supabase
    .from('venues')
    .select('id, name, slug')
    .is('slug', null)
    .not('status', 'eq', 'unverified')
  console.log('Null-slug venues:')
  data?.forEach(v => {
    const slug = `${slugifyName(v.name)}-${uuidShort(v.id)}`
    console.log(`  id:${v.id}  name:"${v.name}"  slug:"${slug}"`)
  })
}
main().catch(e => console.log('err:', e.message))
