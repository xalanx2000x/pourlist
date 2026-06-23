# PourList — Setup from Scratch

Stack: Next.js 16 · Supabase · Mapbox GL JS · OpenAI GPT-4o mini · Tailwind CSS v4

---

## Prerequisites

- Node.js 20+
- pnpm (`npm i -g pnpm`)
- Supabase account (free tier)
- Mapbox account (free — 50k map loads/month)
- OpenAI account with API key

---

## 1. Clone and Install

```bash
git clone https://github.com/xalanx2000x/pourlist.git
cd pourlist
pnpm install
```

---

## 2. Supabase Project

### Create project
1. [supabase.com](https://supabase.com) → New project
2. Note: **Project URL**, **anon key**, **service role key** (Settings → API)

### Create storage bucket
1. Storage → Create bucket → name: `venue-photos`
2. Set to **Public** read access

### Run schema migrations
In Supabase SQL Editor (Dashboard → SQL Editor), run these files in order:

```
supabase-schema.sql
supabase-rate-limit-migration.sql
supabase-photos-fingerprint-migration.sql
supabase-rls-fix-migration.sql
supabase-schema-v2.sql          ← (if present, run after base schema)
```

Or with the Supabase CLI:
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Storage bucket policies
In SQL Editor:
```sql
-- Public read
create policy "Public read" on storage.objects
  for select using (bucket_id = 'venue-photos');

-- Constrained write
create policy "Constrained insert" on storage.objects
  for insert with check (
    bucket_id = 'venue-photos'
    and (storage.foldername(name))[1] is not null
  );
```

---

## 3. Environment Variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...          # mapbox.com — GL JS public token
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon JWT>
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
OPENAI_API_KEY=sk-proj-...                  # platform.openai.com
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

> **Note:** `NEXT_PUBLIC_MAPBOX_TOKEN` uses the `pk.*` prefix — this is public-facing by design. Scope it to your domain in the Mapbox dashboard.

---

## 4. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Map loads centered on Portland's Pearl District (97209) with pre-seeded venues.

---

## 5. Optional: Seed Venue Data

The app starts with an empty map. To load OSM venue data for your city:

```bash
node scripts/seed-osm.mjs
```

Edit the script to target your ZIP code or city coordinates. The seed script is idempotent — `ON CONFLICT` avoids duplicates.

---

## 6. Optional: Custom Local Domain (pourlist.app/devdash)

To run at `pourlist.app` locally (optional, for testing redirects/cookies):

Add to your `/etc/hosts`:
```
127.0.0.1  pourlist.app
```

Then run:
```bash
pnpm dev --hostname pourlist.app
```

---

## Dev Dashboard (`/devdash`)

The app includes a dev dashboard at `/devdash` — live stats on venue counts, submission rates, and active happy hours. No auth by default (for internal use); Vercel deployment is connected to GitHub so it auto-deploys with every push to `main`.

## Key Files

| What | Where |
|---|---|
| Supabase schema + migrations | `*.sql` in project root + `supabase/migrations/` |
| API routes | `src/app/api/` |
| Core components | `src/components/` |
| Library helpers (GPS, EXIF, HH parsing) | `src/lib/` |
| Happy hour parser + truth table | `src/lib/parse-hh.ts`, `scripts/parser-truth-table.ts` |
| Bar close-time table | `src/lib/bar-close-times.ts` |
| Geocoder (Mapbox + Nominatim fallback) | `src/lib/gps.ts` |

---

## Free Tier Limits

| Service | Limit | Notes |
|---|---|---|
| Supabase PostgreSQL | 500MB | Menu text is just strings — ample |
| Supabase Storage | 1GB | 3 photos/venue cap keeps this slow |
| Mapbox GL JS | 50k loads/mo | Token is `pk.*` — scoped to your domain |
| OpenAI GPT-4o mini | ~$0.0003/photo | ~3,300 photos/$1 |
| Vercel hosting | Free | Connected to GitHub main branch |
