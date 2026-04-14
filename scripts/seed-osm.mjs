import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envFile, 'utf8')
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL') || 'https://cuzkquenafzebdqbuwfk.supabase.co'
const SUPABASE_ANON_KEY = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!SUPABASE_ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY not found in .env.local')
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const CITIES = ['New York City, NY','Los Angeles, CA','Chicago, IL','Houston, TX','Phoenix, AZ','Philadelphia, PA','San Antonio, TX','San Diego, CA','Dallas, TX','San Jose, CA','Austin, TX','Jacksonville, FL','Fort Worth, TX','Columbus, OH','Indianapolis, IN','Charlotte, NC','San Francisco, CA','Seattle, WA','Denver, CO','Washington DC','Boston, MA','Nashville, TN','Baltimore, MD','Oklahoma City, OK','Louisville, KY','Portland, OR','Las Vegas, NV','Milwaukee, WI','Albuquerque, NM','Tucson, AZ','Fresno, CA','Sacramento, CA','Mesa, AZ','Kansas City, MO','Atlanta, GA','Miami, FL','Raleigh, NC','Omaha, NE','Minneapolis, MN','Cleveland, OH','Tampa, FL','Arlington, TX','New Orleans, LA','Bakersfield, CA','Tulsa, OK','Honolulu, HI','Anaheim, CA','Santa Ana, CA','Corpus Christi, TX','Riverside, CA','Salt Lake City, UT','Pittsburgh, PA','St. Louis, MO','Cincinnati, OH','Orlando, FL','Buffalo, NY']
async function getBounds(city) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, { headers: { 'User-Agent': 'PourList/1.0' } })
  const data = await res.json()
  if (!data?.length) throw new Error(`City not found: ${city}`)
  return data[0].boundingbox.map(Number)
}
async function queryOSM(bounds, retries = 2) {
  const [south, west, north, east] = bounds
  const q = `[out:json][timeout:90];(node["amenity"="bar"](${south},${west},${north},${east});node["amenity"="restaurant"](${south},${west},${north},${east});node["amenity"="pub"](${south},${west},${north},${east});node["amenity"="brewery"](${south},${west},${north},${east});node["leisure"="pub"](${south},${west},${north},${east});node["amenity"="nightclub"](${south},${west},${north},${east}););out body;`
  const res = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({data:q}).toString() })
  const text = await res.text()
  try {
    const d = JSON.parse(text)
    return d.elements || []
  } catch {
    // Overpass sometimes returns XML errors under load — retry once after delay
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 3000))
      return queryOSM(bounds, retries - 1)
    }
    throw new Error(`Overpass returned non-JSON: ${text.slice(0, 100)}`)
  }
}
const TYPE_MAP = {bar:'Bar', restaurant:'Restaurant', pub:'Pub', brewery:'Brewery', nightclub:'Nightclub'}
function fmtAddr(n,s,c,st,z) { return [n&&s?n+' '+s:n||s, c, st&&z?st+' '+z:st].filter(Boolean).join(', ') || 'Unknown' }
async function seedCity(citySearch, dryRun) {
  const name = citySearch.split(',')[0].trim()
  process.stdout.write(`\n🌆 ${name}... `)
  try {
    const bb = await getBounds(citySearch)
    const els = await queryOSM([bb[0],bb[2],bb[1],bb[3]])
    const venues = els.map(el => { const t=el.tags||{}; return {name:t.name||t['name:en'],amenity:t.amenity||t.leisure||'bar',n:t['addr:housenumber'],s:t['addr:street'],c:t['addr:city'],st:t['addr:state'],z:t['addr:postcode'],lat:el.lat,lon:el.lon} }).filter(v=>v.name&&v.lat&&v.lon)
    console.log(`${venues.length} found${dryRun?' (dry run)':''}`)
    if (dryRun||!venues.length) return {found:venues.length,inserted:0}
    const seen=new Set()
    const records = venues.filter(v=>{const k=v.name+'|'+name;if(seen.has(k))return false;seen.add(k);return true}).map(v=>({name:v.name,address:fmtAddr(v.n,v.s,v.c,v.st,v.z),lat:v.lat,lng:v.lon,zip:v.z,type:TYPE_MAP[v.amenity]||'Bar',status:'unverified',contributor_trust:'osm-seed',created_at:new Date().toISOString()}))
    let inserted=0
    for(let i=0;i<records.length;i+=100){const{error}=await supabase.from('venues').insert(records.slice(i,i+100));if(error)console.error(`  err:${error.message}`);else inserted+=Math.min(100,records.length-i)}
    console.log(`  → ${inserted} inserted`)
    return {found:venues.length,inserted}
  } catch(e){console.log(`❌ ${e}`);return {found:0,inserted:0}}
}
const args=process.argv.slice(2)
const dryRun=args.includes('--dry-run')

// Support --cities-file=<path> to read cities from a line-separated file
const citiesFile = args.find(a=>a.startsWith('--cities-file='))?.split('=')[1]
let cities
if (citiesFile) {
  const { readFileSync } = await import('fs')
  cities = readFileSync(citiesFile, 'utf8').split('\n').map(l=>l.trim()).filter(Boolean)
  console.log(`Loaded ${cities.length} cities from file: ${citiesFile}`)
} else {
  const cityFilter=args.find(a=>a.startsWith('--cities='))?.split('=')[1]?.split(',').map(c=>c.trim())
  cities=cityFilter?CITIES.filter(c=>cityFilter.includes(c.split(',')[0].trim())):CITIES
}
console.log(`\n🍺 PourList OSM Seeder — ${cities.length} cities${dryRun?' (DRY RUN)':''}\n`)
let total=0,inserted=0
for(const city of cities){
  const r=await seedCity(city,dryRun)
  total+=r.found;inserted+=r.inserted
  // Rate limit: wait 1.5s between cities to respect Overpass API
  if(!dryRun && cities.indexOf(city) < cities.length-1) await new Promise(r=>setTimeout(r,1500))
}
console.log(`\n✅ Done — ${total} found, ${inserted} inserted`)
