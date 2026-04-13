#!/usr/bin/env python3
"""Seed PourList venues from OSM via Nominatim + Overpass (no pip needed)"""
import ssl, json, time, urllib.request, urllib.parse, sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

SUPABASE_URL = 'https://cuzkquenafzebdqbuwfk.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1emtxdWVuYWZ6ZWJkcWJ1d2ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDE3NTAsImV4cCI6MjA5MTAxNzc1MH0.OKSifcIYL6epClEL_41C5KIC5bTvYm7mqd4FUrmgkq0'

CITIES = [
    ('New York City','NY',40.7128,-74.0060),('Los Angeles','CA',34.0522,-118.2437),
    ('Chicago','IL',41.8781,-87.6298),('Houston','TX',29.7604,-95.3698),
    ('Phoenix','AZ',33.4484,-112.0740),('Philadelphia','PA',39.9526,-75.1652),
    ('San Antonio','TX',29.4241,-98.4936),('San Diego','CA',32.7157,-117.1611),
    ('Dallas','TX',32.7767,-96.7970),('San Jose','CA',37.3382,-121.8863),
    ('Austin','TX',30.2672,-97.7431),('Jacksonville','FL',30.3322,-81.6557),
    ('Fort Worth','TX',32.7555,-97.3308),('Columbus','OH',39.9612,-82.9988),
    ('Indianapolis','IN',39.7684,-86.1581),('Charlotte','NC',35.2271,-80.8431),
    ('San Francisco','CA',37.7749,-122.4194),('Seattle','WA',47.6062,-122.3321),
    ('Denver','CO',39.7392,-104.9903),('Washington','DC',38.9072,-77.0369),
    ('Boston','MA',42.3601,-71.0589),('Nashville','TN',36.1627,-86.7816),
    ('Baltimore','MD',39.2904,-76.6122),('Oklahoma City','OK',35.4676,-97.5164),
    ('Louisville','KY',38.2527,-85.7585),('Portland','OR',45.5051,-122.6750),
    ('Las Vegas','NV',36.1699,-115.1398),('Milwaukee','WI',43.0389,-87.9065),
    ('Albuquerque','NM',35.0844,-106.6504),('Tucson','AZ',32.2226,-110.9747),
    ('Fresno','CA',36.7378,-119.7871),('Sacramento','CA',38.5816,-121.4944),
    ('Mesa','AZ',33.4152,-111.8315),('Kansas City','MO',39.0997,-94.5786),
    ('Atlanta','GA',33.7490,-84.3880),('Miami','FL',25.7617,-80.1918),
    ('Raleigh','NC',35.7796,-78.6382),('Omaha','NE',41.2565,-95.9345),
    ('Minneapolis','MN',44.9778,-93.2650),('Cleveland','OH',41.4993,-81.6944),
    ('Tampa','FL',27.9506,-82.4572),('Arlington','TX',32.7357,-97.1081),
    ('New Orleans','LA',29.9511,-90.0715),('Bakersfield','CA',35.3733,-119.0187),
    ('Tulsa','OK',36.1540,-95.9928),('Honolulu','HI',21.3069,-157.8583),
    ('Anaheim','CA',33.8366,-117.9143),('Santa Ana','CA',33.7455,-117.8678),
    ('Corpus Christi','TX',27.8006,-97.3964),('Riverside','CA',33.9806,-117.3755),
    ('Salt Lake City','UT',40.7608,-111.8910),('Pittsburgh','PA',40.4406,-79.9959),
    ('St. Louis','MO',38.6270,-90.1994),('Cincinnati','OH',39.1031,-84.5120),
    ('Orlando','FL',28.5383,-81.3792),('Buffalo','NY',42.8864,-78.8784),
]

def fetch_overpass(lat, lon, r=0.15):
    s, w, n, e = lat-r, lon-r, lat+r, lon+r
    q = f'[out:json][timeout:90];(node["amenity"="bar"]({s},{w},{n},{e});node["amenity"="pub"]({s},{w},{n},{e});node["amenity"="restaurant"]({s},{w},{n},{e});node["amenity"="brewery"]({s},{w},{n},{e});node["amenity"="nightclub"]({s},{w},{n},{e}););out body;'
    req = urllib.request.Request('https://overpass.kumi.systems/api/interpreter', data=q.encode(), headers={'Content-Type':'application/x-www-form-urlencoded','User-Agent':'PourList/1.0'}, method='POST')
    with urllib.request.urlopen(req, timeout=150, context=ctx) as resp:
        return json.loads(resp.read().decode()).get('elements', [])

def insert_supabase(venues, city):
    if not venues: return 0
    T = {'bar':'Bar','restaurant':'Restaurant','pub':'Pub','brewery':'Brewery','nightclub':'Nightclub'}
    seen = set(); recs = []
    for v in venues:
        t = v.get('tags') or {}
        nm = t.get('name') or t.get('name:en')
        if not nm: continue
        key = f'{nm}|{city}'
        if key in seen: continue
        seen.add(key)
        amenity = t.get('amenity') or t.get('leisure') or 'bar'
        parts = [t.get('addr:housenumber',''), t.get('addr:street','')]
        addr = ' '.join(filter(None, parts)) or nm
        recs.append({'name':nm,'address':addr,'lat':v['lat'],'lng':v['lon'],'type':T.get(amenity,'Bar'),'status':'unverified','contributor_trust':'osm-seed','created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ')})
    if not recs: return 0
    body = json.dumps(recs).encode()
    req = urllib.request.Request(f'{SUPABASE_URL}/rest/v1/venues', data=body, headers={'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':f'Bearer {SUPABASE_KEY}','Prefer':'return=minimal'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return len(recs)
    except Exception as e:
        print(f'  insert error: {e}'); return 0

def seed(city, state, lat, lon, dry):
    print(f'\n🌆 {city}, {state}... ', end='', flush=True)
    try:
        els = fetch_overpass(lat, lon)
        venues = [{'name':(t:=e.get('tags',{})).get('name')or t.get('name:en'),'lat':e['lat'],'lon':e['lon'],'tags':t} for e in els if (t:=e.get('tags',{})).get('name')or t.get('name:en')]
        print(f'{len(venues)} found', end='')
        if not dry and venues:
            n = insert_supabase(venues, city)
            print(f' -> {n} inserted'); time.sleep(1); return len(venues), n
        print(' (skip)' if dry else '')
        return len(venues), 0
    except Exception as e:
        print(f'FAILED: {e}'); return 0, 0

args = sys.argv[1:]
dry = '--no-dry-run' not in args
cf = next((a.split('=')[1].split(',') for a in args if a.startswith('--cities=')), None)
cities = [(c,s,la,lo) for c,s,la,lo in CITIES if not cf or c in cf]
print(f'PourList Seeder | {len(cities)} cities{" [DRY RUN]" if dry else ""}')
tot, ins = 0, 0
for city, state, lat, lon in cities:
    n, i = seed(city, state, lat, lon, dry)
    tot += n; ins += i
print(f'\nDone — {tot} venues found, {ins} inserted')
