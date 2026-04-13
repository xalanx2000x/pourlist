# The Pour List — Complete Project Blueprint

---

## 1. What It Is

The Pour List is a crowd-sourced happy hour directory where users scan bar/restaurant menus with their phone camera, an AI extracts the text, and the parsed menu is stored as a permanent record — the photo itself is discarded after parsing. It starts with Portland's Pearl District (97209) and is designed to scale nationally.

**Live site:** https://pourlist.vercel.app
**GitHub:** github.com/xalanx2000x/pourlist
**Stack:** Next.js 16 · Supabase (PostgreSQL + Storage) · Mapbox · OpenAI GPT-4o mini · Tailwind CSS

---

## 2. Why It Exists

Happy hour menus change constantly — on paper, on chalkboards, on Instagram. Existing platforms either require restaurants to manually maintain listings (slow, incomplete) or rely on a single source of truth that goes stale. No open, verifiable, community-maintained record of what bars are actually offering and at what price.

The Pour List solves this by making contribution effortless: photograph the menu, AI does the data entry. The crowd keeps it current.

---

## 3. Core Principles

Every decision — technical, product, or UX — is evaluated against these five principles.

### Privacy
Data minimization always. No tracking without consent. No accounts means no personal data to breach. The only identifier is an anonymous device hash (non-cryptographic, browser-fingerprint derived).

### Sovereignty
Users own their data. Exportable, deletable. No lock-in. If the project dies, the data should be portable.

### Simplicity
Solve one problem well. Defaults that work for 80%. No feature creep, no second-order features. The product is "find happy hour menus near me" and "contribute a menu."

### Respect
No dark patterns. No manipulative UX. Rate limits are explained honestly. Submissions are acknowledged. The user is never tricked into contributing more than they intended.

### Elegant UX
The interface feels inevitable — consistent, predictable, works the way you'd expect. On mobile, this means bottom sheets instead of page navigations. The map is always visible. You never lose context.

---

## 4. Architecture

### Services

| Service | Role | Free Tier |
|---|---|---|
| **Vercel** | Next.js hosting, API routes | ✅ 100GB-bandwidth/h |
| **Supabase** | PostgreSQL DB + Storage + Auth helper | ✅ 500MB DB, 1GB storage |
| **Mapbox** | Map rendering, geocoding | ✅ 50k loads/mo (free) |
| **Nominatim (OSM)** | Geocoding (fallback, no API key) | ✅ |
| **OpenAI** | GPT-4o mini for OCR/menu parsing | ~$0.0003/photo |

### Why Mapbox over Google Maps
Google Maps API costs $200+/month at any meaningful volume. Mapbox has a generous free tier and is functionally equivalent for this use case.

### Why Nominatim for Geocoding
Free. No API key required. Used as a fallback when Mapbox geocoding isn't available or for reverse-lookups.

### Database Schema

All tables live in Supabase PostgreSQL. UUID primary keys generated with `gen_random_uuid()`. Timestamps use `timestamptz`.

#### `venues`
```sql
id uuid primary key default gen_random_uuid(),
name text not null,
address text not null,
lat double precision,
lng double precision,
zip text,
phone text,
website text,
type text,
status text default 'unverified'
  check (status in ('unverified', 'verified', 'stale', 'closed')),
contributor_trust text default 'new',
last_verified timestamptz,
photo_count int default 0,
created_at timestamptz default now(),
menu_text text,
menu_text_updated_at timestamptz,
latest_menu_image_url text
```

**Status lifecycle:** `unverified` → `verified` → `stale` (when menu_text_updated_at is old) → `closed` (permanently shut down). Only venues with status `unverified`, `verified`, or `stale` appear on the map.

**contributor_trust:** Tracks contribution history per device hash. New contributors start at `new`. After some approved submissions, can become `trusted`. Used to gate write access via RLS.

#### `photos`
```sql
id uuid primary key default gen_random_uuid(),
venue_id uuid references venues(id) on delete cascade,
url text not null,
uploader_device_hash text not null,
lat double precision,
lng double precision,
status text default 'pending'
  check (status in ('pending', 'approved', 'rejected')),
flagged_count int default 0,
moderation_confidence double precision,
created_at timestamptz default now(),
photo_hash text,
fingerprint text,
location_verified boolean
```

**fingerprint:** A proxy for photo identity — composed of `file size + file name + lastModified`. Not a perceptual hash (no pHash implemented yet). Used to detect near-duplicate uploads within 24 hours.

**status:** `pending` photos are visible only to the uploader. `approved` photos have been verified by a moderator or through geo-check. `rejected` photos are discarded.

**location_verified:** Set to `true` when the photo's GPS (from EXIF or browser geolocation API) is within 10 meters of the venue's known coordinates.

#### `flags`
```sql
id uuid primary key default gen_random_uuid(),
venue_id uuid references venues(id) on delete set null,
photo_id uuid references photos(id) on delete set null,
reason text not null,
device_hash text not null,
created_at timestamptz default now()
```

User-submitted moderation flags for incorrect menus, closed venues, or inappropriate content. `reason` is free text.

#### `events`
```sql
id uuid primary key default gen_random_uuid(),
venue_id uuid references venues(id) on delete set null,
device_hash text not null,
event_type text not null,
created_at timestamptz default now()
```

Audit log of all user actions: photo uploads, menu submissions, flag creations. Used for analytics and abuse detection.

#### `rate_limits`
```sql
device_hash text not null,
action text not null,
count integer not null default 1,
window_start timestamptz not null default now(),
primary key (device_hash, action)
```

Sliding-window rate limiter keyed by device hash and action type. Cleaned up via cron (see Constraints section).

### API Surface

All routes live in `src/app/api/` in a Next.js application.

#### `POST /api/upload-photo`
**Purpose:** Upload a photo of a menu to Supabase Storage and create a photo record.

**Request:** `FormData`
- `photo` — File (required)
- `venueId` — UUID of the venue (optional; if omitted, a new venue will be created)
- `deviceHash` — string (required)
- `lat` — number (optional, from browser or EXIF)
- `lng` — number (optional)
- `fingerprint` — string: `${size}-${name}-${lastModified}` (required)

**Behavior:**
1. Uploads file to Supabase Storage bucket `venue-photos` with path `{venueId}/{uuid}.{ext}`
2. Inserts a record into `photos` table
3. Triggers photo cycling if venue already has 3+ photos (via `cycle_old_photos()`)

**Rate limit:** 10 uploads/hour/device
**Returns:** `{ url: string, fingerprint: string, lat: number, lng: number }`

---

#### `POST /api/submit-menu`
**Purpose:** Submit parsed menu text for a venue, either creating a new venue or updating an existing one.

**Request:**
```json
{
  "menuText": "string (max 10,000 chars, HTML-escaped on save)",
  "venueId": "uuid (optional — omit to create new venue)",
  "venueName": "string (required if no venueId)",
  "address": "string (required if no venueId)",
  "lat": "number (optional)",
  "lng": "number (optional)",
  "deviceHash": "string (required)",
  "photoUrl": "string (required)",
  "photoLat": "number (optional)",
  "photoLng": "number (optional)"
}
```

**Behavior:**
1. **Geo-check:** If `photoLat` and `photoLng` are provided, calculate Haversine distance to venue coordinates. If > 10 meters, return `400` with message: `"Unable to verify location. Please ensure you are standing at the venue."`
2. **New venue:** If no `venueId`, create a venue with the provided `venueName`, `address`, `lat`, `lng`.
3. **Update venue:** Set `menu_text`, `menu_text_updated_at = now()`, update `status` to `verified` (or `unverified` if new contributor), increment `photo_count`.
4. **Mark photo verified:** Set `location_verified = true` on the most recent unverified photo by the same device for this venue.
5. **Call `cycle_old_photos(venueId)`** to prune oldest non-approved photos beyond the 3-photo limit.

**Sanitization:** `menu_text` is HTML-escaped before storage to prevent XSS. Max 10,000 characters.

**Rate limit:** 20 submissions/hour/device

---

#### `POST /api/parse-menu`
**Purpose:** Send a photo to OpenAI GPT-4o mini for menu text extraction.

**Request:**
```json
{
  "imageUrl": "string (Supabase Storage URL)"
}
```
OR
```json
{
  "imageData": "string (base64-encoded image data)"
}
```

**Behavior:**
1. Construct a prompt instructing GPT-4o mini to extract all menu text from the image
2. Send to OpenAI with 30-second timeout (AbortController)
3. Return extracted text

**Rate limit:** 30 parses/hour/device
**Returns:** `{ menuText: string }`

---

#### `POST /api/check-duplicate`
**Purpose:** Detect if a photo has already been submitted within the last 24 hours.

**Request:**
```json
{
  "deviceHash": "string",
  "fingerprint": "string",
  "venueId": "uuid (optional)"
}
```

**Behavior:**
1. Query `photos` for rows where: same `device_hash`, same `fingerprint`, created within 24 hours
2. If `venueId` provided, also filter by that venue
3. If found, return existing venue ID and menu text

**Returns:** `{ isDuplicate: boolean, venueId?: string, existingMenuText?: string }`

---

#### `POST /api/rate-limit-check`
**Purpose:** Check if an action is allowed for a device (used client-side before attempting uploads).

**Request:** `{ "action": "parse-menu" | "submit-menu" | "upload-photo", "deviceHash": "string" }`

**Behavior:**
1. Calls Postgres `check_rate_limit(action, device_hash)` function using the service role client (bypasses RLS)
2. Returns whether the action is permitted

**Returns:** `{ allowed: true | false }`

---

#### `POST /api/delete-old-photos`
**Purpose:** Clean up photos from Supabase Storage and the DB.

**Request:**
```json
{
  "photoIds": ["uuid"],
  "paths": ["venue-photos/venue-id/photo-id.jpg"],
  "venueId": "uuid",
  "cleanup_mode": "time-based" | "specific" | "venue-cycling"
}
```

**Modes:**
- `time-based`: Delete all photos older than 48 hours with status `pending`
- `specific`: Delete photos by `photoIds` and/or `paths`
- `venue-cycling`: Called by `cycle_old_photos()` — deletes oldest non-approved photos beyond 3 per venue

---

### Row-Level Security (RLS) Policies

RLS is enabled on all tables. Policies are constrained to require non-empty device hashes (enforced at the DB level via `check` constraints, not enforced by policy alone).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `venues` | Public | `contributor_trust` is not null | Auth required | Trigger only |
| `photos` | Public | `uploader_device_hash` is not null | — | Trigger only |
| `flags` | Public | `device_hash` is not null | — | — |
| `events` | Public | `device_hash` is not null | — | — |

Before-insert triggers on `photos`, `flags`, and `events` enforce that their respective hash columns are non-empty strings. If empty, the insert raises an exception.

### Migrations (Run in Order)

1. **supabase-schema.sql** — Base schema, PostGIS extension
2. **supabase-rate-limit-migration.sql** — `rate_limits` table + `check_rate_limit()` function
3. **supabase-photos-fingerprint-migration.sql** — `fingerprint` column + index
4. **supabase-rls-fix-migration.sql** — Constrained insert policies, triggers, `rate_tracker` table
5. **cleanup-old-photos-per-venue-migration.sql** — `cycle_old_photos()` function

---

## 5. Setup from Scratch

### Prerequisites

- Node.js 20+
- pnpm (or npm)
- A Supabase project
- An OpenAI API key
- A Mapbox account with a public token

### Step 1: Clone and Install

```bash
git clone https://github.com/xalanx2000x/pourlist.git
cd pourlist
pnpm install
```

### Step 2: Configure Environment Variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...          # Mapbox GL JS public token
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon JWT>
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
OPENAI_API_KEY=sk-proj-...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Step 3: Create Supabase Project

1. Go to [supabase.com](https://supabase.com), create a new project
2. Note the project URL and both API keys (anon + service role) from Settings → API
3. Create a storage bucket named `venue-photos` with public read access

### Step 4: Run Database Migrations

In the Supabase SQL editor (Dashboard → SQL Editor), run each migration file in order:

```bash
# In the supabase/migrations/ directory:
# 1. supabase-schema.sql
# 2. supabase-rate-limit-migration.sql
# 3. supabase-photos-fingerprint-migration.sql
# 4. supabase-rls-fix-migration.sql
# 5. cleanup-old-photos-per-venue-migration.sql
```

Alternatively, use the Supabase CLI:
```bash
supabase link --project-ref <ref>
supabase db push
```

### Step 5: Set Storage Bucket Policies

In Supabase SQL Editor, apply bucket policies for `venue-photos`:

```sql
-- Public read
create policy "Public read" on storage.objects
  for select using (bucket_id = 'venue-photos');

-- Constrained write (requires auth or valid anon key)
create policy "Constrained insert" on storage.objects
  for insert with check (
    bucket_id = 'venue-photos'
    and (storage.foldername(name))[1] is not null
  );
```

### Step 6: Run Locally

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app should load with an empty map centered on Portland's Pearl District.

### Step 7: Verify

1. Tap "Scan Happy Hour Menu"
2. Grant camera permissions (or select from gallery)
3. Point at a menu — the photo should upload, parse, and display extracted text
4. Confirm submission — geo-check validates your location
5. The venue appears on the map

---

## 6. Menu Scan Workflow

This is the core product flow, end to end.

```
[User taps "Scan Happy Hour Menu"]
         │
         ▼
MenuCapture Screen
  • Camera viewfinder (or gallery picker)
  • Geolocation requested via navigator.geolocation.getCurrentPosition
    with enableHighAccuracy: true (preferring EXIF GPS if available)
  • GPS coordinates extracted as the source of truth for location
         │
         ▼
handleCapture (page.tsx handler)
  1. Upload photo → POST /api/upload-photo
     • File stored in Supabase Storage: venue-photos/{venueId}/{uuid}.{ext}
     • Photo record inserted with pending status
  2. GPS lookup → query venues table for any venue within 50m of captured coords
  3. Duplicate check → POST /api/check-duplicate
     • Same fingerprint (size+name+lastModified) + same device within 24h?
     • YES → jump to MenuConfirm pre-filled with existing menu_text
     • NO → continue
  4. Menu parsing → POST /api/parse-menu
     • Photo URL sent to OpenAI GPT-4o mini
     • 30s timeout via AbortController
     • Extracted text returned
         │
         ▼
MenuConfirm Screen
  • Parsed menu text displayed in a textarea
  • User reviews, edits if needed
  • "This looks good" or "Cancel"
         │
         ▼
handleMenuConfirm
  • POST /api/submit-menu
    ├── Geo-check: Haversine(photoLat, photoLng, venueLat, venueLng) ≤ 10m?
    │     FAIL → 400 error: "Unable to verify location. Please ensure you are
    │             standing at the venue." — submission rejected
    │     PASS → continue
    ├── Sanitize menu_text: max 10,000 chars, HTML-escape all content
    ├── If no venueId: create new venue record
    ├── If venueId: update existing venue record
    │     • menu_text updated
    │     • menu_text_updated_at = now()
    │     • status → 'verified' (or 'unverified' for new contributor)
    │     • photo_count incremented
    ├── Mark most recent unverified photo by this device: location_verified = true
    └── Call cycle_old_photos(venueId)
          • Delete oldest non-approved photos beyond the 3 most recent
          • Removes from both Supabase Storage and photos table
         │
         ▼
[Photo is discarded from storage after parsing]
[menu_text is the permanent artifact]
```

### Photo Lifecycle Summary

1. Photo is captured and temporarily stored in Supabase Storage
2. GPT-4o mini reads it and returns text
3. Photo is deleted from storage by the upload flow's cleanup logic
4. `menu_text` is the only persistent artifact stored in `venues.menu_text`
5. A maximum of 3 photos per venue are retained (the most recent non-rejected ones)

---

## 7. Key Design Decisions

### Store Text, Not Photos
The photo is scanner input. The product is structured menu text. This keeps the DB small, avoids image hosting costs, and makes the data immediately useful (searchable, copyable). Photos are deleted from storage after parsing.

### No User Accounts
Every user is anonymous. Identity is an opaque device hash (SHA-256 of user agent + screen size + timezone + locale). No email, no password, no OAuth. This eliminates account recovery, password storage, and PII liability. The tradeoff is no per-user history or contribution tracking — anonymity is the feature.

### No Review System
Instead of building a stars-and-reviews platform, The Pour List links out to Google Maps and Yelp for venue ratings. This sidesteps the hardest UX problem in crowdsourced data (review fraud, moderation, appeals) and keeps the scope tight.

### Bottom Sheets on Mobile
Users never navigate away from the map. Tapping a venue opens a bottom sheet. Tapping "Scan" opens the camera in a bottom sheet. Context is never lost. This is a deliberate mobile-first decision that prioritizes exploration over task completion.

### GPS Geo-Check
Photo GPS vs. venue GPS must be within 10 meters. This prevents remote submissions and ensures every menu was actually photographed at the venue. The Haversine formula is used for distance calculation.

### Device Hash, Not User ID
A cryptographic hash would be more identifying. A non-cryptographic browser fingerprint (UA + screen + timezone + locale) is anonymous by design — it's enough to rate-limit and detect abuse, not enough to track a user across sites. The choice prioritizes privacy over precision.

### Bottom-Up Venue Creation
Venues don't need to exist in the DB before a photo is submitted. If a menu is scanned at a location with no matching venue (within 50m), a new venue is created on the fly. This means the first contributor for any bar creates the listing. No onboarding burden for venues.

---

## 8. Running and Testing Locally

### Development Server

```bash
pnpm dev
# → http://localhost:3000
```

### Environment

The app requires all six environment variables (see Section 5, Step 2). Without valid Supabase and OpenAI credentials, API routes will return 500 errors.

### Testing the Full Flow

**Prerequisites:** A physical device or browser with camera access and GPS.

1. Visit `/` — map should load centered on the Pearl District (97209)
2. Tap the camera icon → grant permissions
3. Point camera at a menu (or use a test image from gallery)
4. Watch: photo upload → GPS lookup → GPT-4o parsing → text display
5. Confirm submission
6. If on-site (within 10m of a known venue), submission succeeds
7. If remote, geo-check fails with the location error
8. New venue appears on map with menu text

### Testing Individual API Routes

```bash
# Upload photo
curl -X POST http://localhost:3000/api/upload-photo \
  -F "photo=@menu.jpg" \
  -F "deviceHash=test-device" \
  -F "lat=45.523" \
  -F "lng=-122.676" \
  -F "fingerprint=12345-menu.jpg-1234567890"

# Parse menu (requires a valid Supabase storage URL)
curl -X POST http://localhost:3000/api/parse-menu \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://<project>.supabase.co/storage/v1/object/public/venue-photos/..."}'

# Submit menu
curl -X POST http://localhost:3000/api/submit-menu \
  -H "Content-Type: application/json" \
  -d '{
    "venueName": "Test Bar",
    "address": "123 NW 10th Ave, Portland, OR",
    "menuText": "IPA — $6",
    "deviceHash": "test-device",
    "photoUrl": "https://...",
    "photoLat": 45.523,
    "photoLng": -122.676
  }'
```

### Seed Data

To test with existing data, manually insert into Supabase:

```sql
insert into venues (name, address, lat, lng, zip, status, menu_text)
values (
  'Alder & Co.',
  '1231 SW 10th Ave, Portland, OR 97205',
  45.5192, -122.6817,
  '97205',
  'verified',
  'IPA — $7 | Lager — $5 | House Red — $8'
);
```

### Rate Limit Testing

Rate limits are enforced per `deviceHash`. To test, use a consistent hash string across requests and watch for 429 responses after the threshold.

| Action | Limit |
|---|---|
| `upload-photo` | 10/hr |
| `submit-menu` | 20/hr |
| `parse-menu` | 30/hr |

---

## 9. What Makes It Distinctive

**Zero-friction contribution.** The Yelp problem is that writing a review takes effort. The Google problem is that listings go stale. The Pour List solves both: photographing a menu is 3 seconds of work, and the community keeps it current.

**No accounts, no tracking, no dark patterns.** The privacy stance is the product stance. Users don't have to trust a company with their data because there is no data to lose.

**Bottom-up, not top-down.** Venues don't sign up. Users don't sign up. Listings emerge from actual visits. A bar that opens tomorrow can have a listing tonight if someone walks in.

**GPS-verified submissions.** The 10-meter geo-check means every menu in the database was physically at that location. No scraping, no copy-paste, no stale menu from 2022.

**The photo is ephemeral, the text is permanent.** This framing — "we photograph menus so we can forget the photos" — is the core insight. It reframes what the product is.

---

## 10. Constraints and Limitations

### Supabase Free Tier

- **500MB PostgreSQL** — menu_text is just text, so this is ample. Watch `latest_menu_image_url` (photo URLs stored as text); photos themselves live in Storage (1GB limit).
- **1GB Storage** — With a 3-photo cap per venue and aggressive cycling, storage grows slowly. Approximate max: ~330k venue submissions (3 photos × 500KB avg = 500MB).
- **No pg_cron** — Scheduled cleanup jobs cannot run as Supabase cron jobs. Cleanup runs inline in API routes or must be triggered externally.
- **No Supabase Edge Functions** — All server-side logic must live in Next.js API routes (which is where it already lives).

### Rate Limit Cleanup

The `rate_limits` table grows indefinitely unless cleaned. Two cron jobs are needed:
- Every 10 minutes: clean up `rate_tracker` (short-lived sliding window state)
- Every hour: clean up `rate_limits` (remove entries older than the window)

Since pg_cron is unavailable, these must run as an external cron job (e.g., Vercel Cron, a separate Node script, or GitHub Actions scheduled workflow) hitting a cleanup endpoint.

### No Image Moderation

Photos are not currently run through any image moderation pipeline before storage. The 10-meter geo-check and device hash rate limiting are the only spam deterrents. A production deployment should add an OpenAI Vision moderation step in `/api/parse-menu` or `/api/upload-photo`.

### No Perceptual Hashing

Duplicate detection uses a naive fingerprint (file size + name + lastModified). Two photos of the same menu at different times will have different fingerprints. pHash (perceptual hashing) would catch visually identical images regardless of file metadata, but has not been implemented.

### No Venue Verification Pipeline

New venues created by contributors go through no human review. `status` defaults to `unverified`. A venue becomes `verified` when a menu is submitted and passes geo-check, but there's no systematic re-verification when menus change. A `stale` status is set conceptually but the logic for marking venues stale based on `menu_text_updated_at` age is not yet automated.

### Mapbox Token is Public

The Mapbox public token (`pk.*`) is exposed client-side — this is intentional and expected for Mapbox GL JS. It cannot be rotated to a secret server-side token. Keep the token scoped to this domain in the Mapbox dashboard.

---

## 11. Component and File Structure

Every file in the project and what it does. Use this as a map for rebuilding or navigating the codebase.

### Pages (`src/app/`)

| File | Purpose |
|---|---|
| `page.tsx` | **Main app page.** Owns all global state: venues list, selected venue, scan workflow (`idle` → `capture` → `confirm`), radius filter, view mode (map/list), user location. Renders header, radius selector, tab bar, Map + VenueList, bottom action bar. Contains `handleCapture()` and `handleMenuConfirm()` — the two main workflow handlers. |
| `layout.tsx` | **Root layout.** Registers the service worker for PWA/offline support (`/sw.js`). Sets global metadata (title, description, theme color `#f59e0b`, manifest). Loads Google Fonts (Geist, Geist Mono). |
| `globals.css` | **Global styles + Tailwind.** `@import "tailwindcss"` (v4). CSS variables for `--color-primary: #f59e0b`. Custom scrollbar styling. Mapbox popup overrides. No BEM or custom utility classes — everything goes through Tailwind. |
| `admin/page.tsx` | **Admin review portal.** Password-gated (`NEXT_PUBLIC_ADMIN_PASSWORD` env var, defaults to `pourlist-admin`). Tabs: pending / approved / rejected. Approve/reject actions update venue `status` via Supabase. |

### API Routes (`src/app/api/`)

| Route | Purpose |
|---|---|
| `parse-menu/route.ts` | **GPT-4o mini menu extraction.** Accepts `{ imageUrl }` (Supabase URL) or `{ imageData }` (base64 data URL sent directly from browser). Rate-limits at 30/hr. 30s timeout via `AbortController`. Returns `{ text }`. |
| `submit-menu/route.ts` | **Create or update venue with menu text.** Runs Haversine geo-check (≤10m required). HTML-escapes and saves `menu_text`. Calls `cycle_old_photos()` via Supabase RPC. Returns `{ venueId, success }`. |
| `upload-photo/route.ts` | **Upload photo to Supabase Storage + insert photos DB record.** Handles per-venue photo cycling (keeps 3 most recent). Deletes old storage files after cycling. Rate-limits at 10/hr. |
| `check-duplicate/route.ts` | **Detect near-duplicate submissions.** Queries `photos` for same `device_hash` + same `photo_hash` within 24h. Returns `{ isDuplicate, venueId?, existingMenuText? }`. |
| `rate-limit-check/route.ts` | **Server-side rate limit enforcement.** Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. Calls Postgres `check_rate_limit()` RPC. Returns `{ allowed }`. |
| `track-event/route.ts` | **Analytics event logger.** Writes to `events` table. Fire-and-forget — always returns 200 so failures never impact UX. |
| `delete-old-photos/route.ts` | **Multi-mode photo cleanup.** Supports time-based (48h legacy), per-venue cycling, and specific ID/path deletion. Uses service role client. |

### Components (`src/components/`)

| Component | Purpose | Key State |
|---|---|---|
| `Map.tsx` | **Mapbox GL JS map.** Dynamically imported (`ssr: false`) to avoid SSR issues with the GL API. Renders venue markers as GeoJSON source with clustering. Click handlers for cluster zoom + venue select. Color-codes pins: purple = active HH, amber = verified, yellow = unverified, orange = stale. | Receives `venues`, `selectedVenue`, `onVenueSelect` as props |
| `VenueList.tsx` | **Scrollable venue list (sidebar or full view).** Receives `venues[]`, `selectedVenue`, `onVenueSelect`. Shows count + active HH count in header. Renders `VenueCard` per venue. | Pure display, no internal state |
| `VenueCard.tsx` | **Single venue row.** Shows name, address, type badge, HH active badge, status badge (New/Needs Update). Emits `onClick` to parent. | Pure display |
| `VenueDetail.tsx` | **Bottom-sheet venue detail panel.** Absolute-positioned at bottom of map area. Shows name, address, phone, website, latest menu image, `menu_text`, Google Maps/Yelp links. | Pure display, `onClose` callback |
| `MenuCapture.tsx` | **Photo selection bottom sheet.** File input (multi-image, accepts HEIC). Validates type, size, batch total. Extracts EXIF GPS from first photo via `extractGpsFromPhoto()`. Falls back to browser geolocation. Shows preview thumbnails with page labels. | Internal: `step`, `files`, `previewUrls`, `loading`, `error` |
| `MenuConfirm.tsx` | **Menu review and submission sheet.** Full-screen overlay. Shows parsed text (editable textarea), matched venue status, source photo thumbnails, save error. Submits via `onConfirm(menuText, venueId?)`. | Internal: `editing`, `text` (synced with `parsedText` prop) |
| `AddVenueForm.tsx` | **Add venue bottom sheet.** Form: name, address, phone, website, type (select). Reverse-geocodes from `initialCoords` if provided. Inserts via `addVenue()` from `lib/venues.ts`. | Internal: `form`, `loading`, `message` |
| `OnboardingModal.tsx` | **First-visit tour.** 3-step carousel. Marks seen in `localStorage` (`pourlist_onboarding_seen`). Exports `useOnboarding()` hook. | Internal: `step` |
| `SupportScreen.tsx` | **Tip jar bottom sheet.** Cash App (`$PourListPDX`) and Venmo (`@PourListPDX`) payment links. | Stateless |

### Library Files (`src/lib/`)

| File | Purpose |
|---|---|
| `supabase.ts` | **Supabase client + type exports.** Creates anon client with `createClient()`. Exports `Venue`, `Photo`, `Flag` TypeScript types. The `Venue` type is the canonical interface used everywhere. |
| `venues.ts` | **Venue data access.** `getVenuesByZip(zip)` — fetches all non-closed venues for a ZIP. `getVenueById(id)`, `addVenue(venue)`, `getVenuePhotos(venueId)`, `submitPhoto(...)`, `flagContent(...)`. All use the anon Supabase client. |
| `device.ts` | **Device identity.** `getDeviceHash()` — creates a non-cryptographic browser fingerprint from UA + language + screen dimensions + color depth + timezone offset. Returns `device_<base36 hash>`. Not personally identifying. Also exports `reverseGeocode()` (Mapbox primary, Nominatim fallback). |
| `gps.ts` | **GPS extraction.** `extractGpsFromPhoto(file)` — uses **ExifReader** library to read EXIF GPS data from a photo's binary. Returns `{ lat, lng }` or `null`. `getBrowserLocation()` — wraps `navigator.geolocation.getCurrentPosition()` with 5s timeout, high accuracy. |
| `imageHash.ts` | **Photo fingerprinting.** `fingerprintFile(file)` — returns `${file.size}-${file.name.toLowerCase().trim()}-${file.lastModified}`. Used for duplicate detection. `isSamePhotoFingerprint()` — compares two fingerprints (exact size match = likely duplicate). |
| `imageResize.ts` | **Image processing.** `fileToBase64(file, maxSizeMB)` — converts a `File` to a base64 JPEG data URL. Handles HEIC→JPEG conversion via **heic2any** before processing. If image is larger than `maxSizeMB`, uses `<canvas>` to resize proportionally (preserving aspect ratio). Quality iterated down from 0.85 to 0.3 until under size limit. Returns data URL. |
| `activeHH.ts` | **Happy hour status checker.** `hasActiveHappyHour(menuText)` — pure function that parses `menu_text` string. Detects time windows (e.g. "3-6pm"), day-of-week restrictions, and HH terminology. Returns `boolean`. Used by `Map` and `VenueCard` to color-code pins. |
| `happyHourCheck.ts` | **HH signal detector.** `checkHappyHour(text)` — extracts happy hour signals from raw text for the screening step during menu capture. Returns `{ isHappyHour, signals[] }`. Not used after parsing — only for the "is this a HH menu?" warning. |
| `rateLimit.ts` | **Client-side rate limiter.** `checkRateLimit(deviceHash)` — localStorage-based sliding window. Unlimited submissions for first 2 minutes, then 1 per 2 minutes. Returns `{ allowed, retryAfterMs? }`. Fails open (allows) if localStorage unavailable. |
| `analytics.ts` | **Event tracking.** `trackEvent(eventName, options)` — fires `POST /api/track-event`. Fire-and-forget, always resolves. Tracks: `menu_capture`, `menu_parse_success`, `menu_parse_failure`, `menu_save_success`, `menu_save_failure`, `venue_view`, `onboarding_complete`, `onboarding_skip`. |

### Configuration Files (project root)

| File | Purpose |
|---|---|
| `next.config.ts` | Minimal Next.js config (no special plugins). TypeScript-only. |
| `tsconfig.json` | Path alias `@/*` → `./src/*`. Strict mode. Includes `*.mts` for ESM scripts. |
| `postcss.config.mjs` | Uses `@tailwindcss/postcss` (Tailwind v4). |
| `tailwind.config.*` | Not present — Tailwind v4 uses CSS-only config (`globals.css` `@import "tailwindcss"`). |
| `eslint.config.mjs` | ESLint flat config. |
| `vercel.json` | Vercel deployment config (defaults). |
| `public/manifest.json` | PWA manifest. Name "The Pour List", theme color `#f59e0b`, `display: standalone`. |
| `public/sw.js` | Service worker for PWA offline support (registered in `layout.tsx` on production builds). |
| `public/*.svg` | Vite/Next.js default placeholder SVGs (not used in app). |

### Database Migrations (`migrations/` + project root SQL files)

| File | Purpose |
|---|---|
| `supabase-schema.sql` | Base schema: `venues`, `photos`, `flags`, `events` tables. PostGIS extension. |
| `supabase-rate-limit-migration.sql` | `rate_limits` table + `check_rate_limit()` Postgres function. |
| `supabase-photos-fingerprint-migration.sql` | `fingerprint` column on `photos` + index. |
| `supabase-rls-fix-migration.sql` | Constrained RLS insert policies, before-insert triggers, `rate_tracker` table. |
| `cleanup-old-photos-per-venue-migration.sql` | `cycle_old_photos(p_venue_id)` Postgres function — keeps 3 most recent non-rejected photos per venue, returns deleted rows with storage paths. |
| `migrations/001_events_and_columns.sql` | Adds `events` table + `latest_menu_image_url` and `menu_text_updated_at` columns to `venues`. |
| `cleanup-cron.sql` | External cron cleanup SQL (run via external scheduler). |
| `fix-delete-policy.sql` | Storage bucket delete policy fix. |

### Seed Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `scripts/seed-osm.mjs` | **Primary seed script.** Queries OpenStreetMap via Overpass API for bars/restaurants in US cities using Nominatim geocoding. Extracts name, address, lat/lon, type from OSM tags. Inserts into Supabase `venues` table. Currently seeds Pearl District (Portland) + other US cities. |
| `scripts/seed-osm.ts` | TypeScript version of the OSM seed script (parallel use). |
| `scripts/seed-python.py` | Python seed script alternative. |
| `scripts/run-schema.js` | Runs `supabase-schema.sql` against a live Supabase project via the JS client. |

---

## 12. Seed Data

### Pearl District Initial Seeding

The app launches with venues pre-loaded from OpenStreetMap data via `scripts/seed-osm.mjs`. This script:

1. Uses **Nominatim** (OpenStreetMap's geocoder) to look up city boundaries
2. Queries the **Overpass API** (`https://overpass-api.de/api/interpreter`) for all nodes tagged with:
   - `amenity=bar`, `amenity=restaurant`, `amenity=pub`, `amenity=brewery`
   - `leisure=pub`, `amenity=nightclub`
3. Extracts `name`, `addr:housenumber`, `addr:street`, `addr:city`, `addr:state`, `addr:postcode`, `lat`, `lon`
4. Maps OSM amenity types to the app's `type` enum: `Bar`, `Restaurant`, `Pub`, `Brewery`, `Nightclub`
5. Inserts into Supabase `venues` with `status: 'unverified'`, `zip: '97209'`, `contributor_trust: 'new'`

### Pearl District Venue Data (97209)

The current database contains **61 Pearl District venues** seeded from OSM. Example records:

```sql
-- A bar
insert into venues (name, address, lat, lng, zip, type, status, contributor_trust)
values (
  'Alder & Co.',
  '1231 SW 10th Ave, Portland, OR 97205',
  45.5192, -122.6817,
  '97209',
  'Bar',
  'unverified',
  'new'
);

-- A restaurant
insert into venues (name, address, lat, lng, zip, type, status, contributor_trust)
values (
  'Tasty n Alder',
  '1400 SW 10th Ave, Portland, OR 97205',
  45.5188, -122.6819,
  '97209',
  'Restaurant',
  'unverified',
  'new'
);
```

### Seed Data Fields

Each seeded venue record contains:

| Field | Value for OSM seeds |
|---|---|
| `name` | OSM `name` or `name:en` tag |
| `address` | `addr:housenumber + addr:street, addr:city, addr:state addr:postcode` |
| `lat` / `lng` | OSM node lat/lon (WGS84) |
| `zip` | `97209` (Pearl District default for initial seed) |
| `type` | Mapped from OSM amenity tag |
| `status` | `'unverified'` |
| `contributor_trust` | `'new'` |
| `menu_text` | `null` (filled in by user submissions) |
| `menu_text_updated_at` | `null` |
| `latest_menu_image_url` | `null` |
| `photo_count` | `0` |

### Seeding a New City

To seed a new ZIP code or city, modify `scripts/seed-osm.mjs` or run manually:

```bash
node scripts/seed-osm.mjs
```

The script is idempotent — it uses `ON CONFLICT` to avoid duplicating venues that already exist in the DB.

---

## 13. Mapbox Integration Details

### Which Mapbox APIs Are Used

**Mapbox GL JS** (`mapbox-gl` npm package, v3) handles all map rendering and user interaction. This is the primary integration.

**Mapbox Geocoding API** (`https://api.mapbox.com/geocoding/v5/...`) is used server-side in `submit-menu/route.ts` for reverse geocoding (`lat/lng → address`). It is NOT used for map searching.

The token (`NEXT_PUBLIC_MAPBOX_TOKEN`) uses the `pk.*` public prefix — this is expected and safe for Mapbox GL JS, which requires a public token client-side.

### How the Map Renders Venues

`Map.tsx` is the only component that uses Mapbox. It works as follows:

1. **Initialization** (`useEffect`, runs once on mount):
   - Sets `mapboxgl.accessToken = MAPBOX_TOKEN`
   - Creates `new mapboxgl.Map()` with `streets-v12` style
   - Center: `[-122.6819, 45.5231]` (Pearl District)
   - Initial zoom: `15`
   - Adds `NavigationControl` (zoom buttons, top-right)

2. **GeoJSON source** (`useEffect` on `venues` or `mapLoaded` change):
   - Venues are converted to a GeoJSON `FeatureCollection` via `buildGeoJSON()`
   - Only venues with both `lat` and `lng` are included
   - Each feature stores: `id`, `name`, `address`, `status`, `hasHH` (pre-computed via `hasActiveHappyHour()`)

3. **Clustering**: The GeoJSON source has `cluster: true` with `clusterRadius: 50`, `clusterMaxZoom: 14`. Cluster circles are amber (`#f59e0b`). Clicking a cluster calls `getClusterExpansionZoom()` and flies to the expanded view.

4. **Individual markers** (the `unclustered-point` layer):
   - **Purple** (`#7c3aed`) = active happy hour currently (`hasActiveHappyHour()` returns true)
   - **Amber** (`#f59e0b`) = verified
   - **Yellow** (`#fbbf24`) = unverified
   - **Orange** (`#f97316`) = stale
   - All have a white 2px stroke and 8px radius

5. **Interaction**:
   - `click` on `unclustered-point` → calls `onVenueSelect(venue)` with the matched venue
   - `mouseenter`/`mouseleave` on any layer → cursor changes to pointer
   - Fly-to animation when `selectedVenue` prop changes: `{ center: [lng, lat], zoom: 16, duration: 1000 }`

### Radius Selector and Venue Filtering

The radius selector lives in `page.tsx` (main component) as the horizontal button row below the header. The `radius` state (in miles) filters venues client-side after they're fetched:

```typescript
// In loadVenues() — filters after fetching all 97209 venues
if (userLocation) {
  filtered = data.filter(v => {
    if (!v.lat || !v.lng) return true
    // Approximate km from lat/lng diff (111km per degree lat, ~85km per degree lng at this latitude)
    const km = Math.sqrt(
      Math.pow((v.lat - userLocation.lat) * 111, 2) +
      Math.pow((v.lng - userLocation.lng) * 85, 2)
    )
    const miles = km * 0.621371
    return miles <= radius
  })
}
```

This is a simple Euclidean approximation — not a true great-circle distance, but accurate enough for small areas like the Pearl District. Venues without coordinates always pass the filter.

Radius options: `¼ mi`, `½ mi`, `1 mi`, `2 mi`, `5 mi`, `10 mi`, `25 mi`. Default is `1` mile.

### Nominatim Fallback for Geocoding

When Mapbox geocoding fails or the token is unavailable, both `device.ts` and `submit-menu/route.ts` fall back to:

```
https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18&addressdetails=1
```

No API key required. Requires `User-Agent: PourList/1.0` header.

---

## 14. State Management

The app uses **React component state** exclusively — no Redux, Zustand, Context API, or other global state library. All state lives in `page.tsx` and is passed down as props to child components.

### State in `page.tsx` (the single source of truth)

| State Variable | Type | Purpose |
|---|---|---|
| `venues` | `Venue[]` | Fetched venue list, filtered by radius |
| `loading` | `boolean` | Initial load spinner |
| `selectedVenue` | `Venue \| null` | Currently selected venue (opens `VenueDetail` sheet) |
| `viewMode` | `'map' \| 'list'` | Tab selection |
| `showAddVenue` | `boolean` | Controls `AddVenueForm` visibility |
| `radius` | `number` | Current radius filter in miles |
| `userLocation` | `{ lat, lng } \| null` | Browser geolocation, fetched on mount |
| `scanStep` | `'idle' \| 'capture' \| 'confirm'` | Menu scan workflow step |
| `scanFiles` | `File[]` | Captured photo files |
| `scanGps` | `{ lat, lng } \| null` | GPS from EXIF or browser |
| `parsedText` | `string` | GPT-4o extracted menu text |
| `matchedVenue` | `Venue \| null` | Venue found within 50m of capture GPS |
| `isDuplicate` | `boolean` | Duplicate submission flag |
| `isNotHH` | `boolean` | Menu doesn't look like a HH menu |
| `scanLoading` | `boolean` | Parsing in progress |
| `scanError` | `string` | Parsing error message |
| `submitLoading` | `boolean` | Submission in progress |
| `saveError` | `string` | Submission error message |
| `saveSuccess` | `boolean` | Shows "✓ Saved" banner for 3s |
| `rateLimitError` | `string \| null` | Client-side rate limit message |
| `onboardingOpen` | `boolean` | Onboarding modal visibility |
| `supportOpen` | `boolean` | Tip jar visibility |

### Props Passed Down

```
page.tsx
├── Map (dynamic, ssr:false) → venues, selectedVenue, onVenueSelect
├── VenueList → venues, selectedVenue, onVenueSelect
├── VenueDetail → venue, onClose
├── AddVenueForm → onClose, onVenueAdded
├── MenuCapture → onCapture, onClose
├── MenuConfirm → files, gps, parsedText, matchedVenue, isDuplicate,
│                 isNotHH, existingMenuText, isLoading, isParsing,
│                 saveError, onRetry, onConfirm, onReject, onClose
├── OnboardingModal → onClose
└── SupportScreen → onClose
```

### Cross-Cutting Concerns

- **`localStorage`** — `OnboardingModal` reads/writes `pourlist_onboarding_seen` key. `rateLimit.ts` reads/writes `pourlist_submit_<deviceHash>` keys. Both fail open silently if localStorage is unavailable.
- **Service Worker** (`public/sw.js`) — registered once in `layout.tsx` on production builds. Used for PWA offline caching (not for data sync).
- **No React Context** — state is not shared across unrelated branches. Each leaf component receives only the props it needs.

---

## 15. The Full Data Flow

How a user action propagates through the system to a UI update. This traces a complete "scan and save" flow.

### Flow A: Viewing Venues on the Map

```
User opens app
    │
    ▼
page.tsx useEffect (on mount)
    │
    ├─► getBrowserLocation()  →  setUserLocation({ lat, lng })
    │
    └─► loadVenues()  [calls getVenuesByZip('97209')]
              │
              │  supabase.from('venues').select('*').eq('zip','97209').neq('status','closed')
              │
              ▼
         Supabase PostgreSQL
              │
              │  Returns Venue[] (all Pearl District venues)
              │
              ▼
         page.tsx: setVenues(filtered by radius)
              │
              ▼
         Map.tsx: re-renders via venues prop change
              │  buildGeoJSON(venues) → GeoJSON FeatureCollection
              │  map.getSource('venues').setData(geojson)  ← updates pins in place
              │
              ▼
         User sees updated pins on map (clustered or individual)
```

### Flow B: Scanning and Saving a Menu

```
User taps "Scan Happy Hour Menu"
    │
    ▼
page.tsx: setScanStep('capture')
    │
    ▼
MenuCapture bottom sheet opens
    │
User selects photo(s) from gallery / takes photo
    │
MenuCapture: processFiles(files)
    │
    ├─► validate: type must be image/*, HEIC accepted, max 10MB/file, 15MB total
    │
    ├─► extractGpsFromPhoto(files[0])  [ExifReader]
    │     └─► Returns { lat, lng } or null
    │
    └─► If no EXIF GPS → getBrowserLocation()  [navigator.geolocation]
              │
              ▼
         MenuCapture: setStep('preview')
              │
              ▼
MenuCapture: onCapture(files, gps)  [passed up to page.tsx]
    │
    ▼
page.tsx handleCapture(files, gps)
    │
    ├─► fileToBase64(file, 3) for each file  [heic2any → canvas resize]
    │     └─► imageDataUrls: string[] (base64 data URLs)
    │
    ├─► getVenuesByZip('97209')  [to find nearby venue]
    │     └─► For each venue with lat/lng:
    │           Check if within ~50m of gps (sqrt((Δlat*111)² + (Δlng*85)²) < 0.05km)
    │     └─► setMatchedVenue(nearbyVenue)
    │
    ├─► POST /api/parse-menu  [for each page, one at a time]
    │     body: { imageData: base64DataUrl }
    │     │
    │     │  openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user',
    │     │    content: [{ type: 'text', ... }, { type: 'image_url', image_url: { url: imageData } }] }]
    │     │  }, { signal: AbortController(30s) })
    │     │
    │     └─► Returns { text: extractedMenuString }
    │
    ├─► checkHappyHour(combinedText)  [simple string pattern matching]
    │     └─► setIsNotHH(!isHappyHour)
    │
    └─► setScanStep('confirm')
              │
              ▼
MenuConfirm sheet opens
    │  Shows: parsedText (editable), matchedVenue status, isNotHH warning
              │
User taps "Save Menu" (or edits text first)
              │
              ▼
page.tsx handleMenuConfirm(menuText, venueId?)
    │
    ├─► checkRateLimit(deviceHash)  [client-side, fail-fast]
    │     └─► If not allowed: setRateLimitError(...) → shown to user
    │
    ├─► POST /api/upload-photo  [first file only, reference image]
    │     FormData: photo, venueId?, deviceHash, lat?, lng?, fingerprint?
    │     │
    │     │  supabase.storage.from('venue-photos').upload(filePath, buffer)
    │     │  supabase.from('photos').insert({ venue_id, url, uploader_device_hash, status:'pending' })
    │     │  supabaseAdmin.rpc('cycle_old_photos', { p_venue_id: venueId })  [keeps 3 most recent]
    │     │  → Deletes old storage files
    │     │
    │     └─► Returns { url: publicPhotoUrl, fingerprint, lat, lng }
    │
    └─► POST /api/submit-menu
              body: { menuText, venueId?, venueName, address, lat, lng,
                      deviceHash, imageUrl }
              │
              │  ┌── If no venueId:
              │  │   reverseGeocode(lat,lng) → address
              │  │   supabase.from('venues').insert({ name, address, zip:'97209',
              │  │       status:'unverified', menu_text: sanitized(menuText) })
              │  │   → Returns { id: newVenueId }
              │  │
              │  └── If venueId provided:
              │       supabase.from('venues').update({ menu_text, menu_text_updated_at: now() })
              │       .eq('id', venueId)
              │
              │       [Geo-check]
              │       haversineDistance(photoLat, photoLng, venueLat, venueLng) ≤ 10m?
              │       └─► FAIL → 400: "Unable to verify location..."
              │       └─► PASS → supabase.from('photos').update({ location_verified: true })
              │
              └─► Returns { venueId, success }
                       │
                       ▼
                  loadVenues()  [refresh venue list]
                       │
                       ▼
                  setSelectedVenue({ ...matchedVenue, menu_text })  [update detail view]
                       │
                       ▼
                  setSaveSuccess(true)  → "✓ Saved" banner shown for 3s
                       │
                       ▼
                  Reset scan workflow: scanStep → 'idle', scanFiles → [], etc.
```

### Flow C: Selecting a Venue on the Map

```
User taps a map pin
    │
Map.tsx: 'click' on 'unclustered-point' layer
    │
    └─► const venue = venues.find(v => v.id === props.id)
         onVenueSelect(venue)
              │
              ▼
page.tsx: handleVenueSelect(venue)
    │
    ├─► trackEvent('venue_view', { deviceHash, venueId })
    │
    └─► setSelectedVenue(venue)
              │
              ▼
VenueDetail renders (absolute positioned at bottom of map area)
    │
    ├─► hasActiveHappyHour(venue.menu_text)  [purple HH badge]
    ├─► venue.menu_text ? shows menu text block : shows "No menu on file" message
    └─► Google/Yelp links constructed from venue.name + venue.address
```

---

## 16. Key Implementation Details

### EXIF Reading — ExifReader

The app uses **`exifreader`** (npm, v4.37.1+) to extract GPS coordinates from photo EXIF data. It's imported in `src/lib/gps.ts`:

```typescript
import ExifReader from 'exifreader'

export async function extractGpsFromPhoto(file: File): Promise<GpsCoords | null> {
  const tags = await ExifReader.load(file, { expanded: true })
  if (!tags.gps) return null
  return { lat: tags.gps.Latitude, lng: tags.gps.Longitude }
}
```

EXIF GPS is the **preferred** location source. If the photo was taken with a phone camera and location services were enabled, the EXIF data contains WGS84 decimal degrees. This is checked before falling back to browser geolocation.

### HEIC Image Handling — heic2any

Photos from iPhones are often HEIC format. The app converts them before processing using **`heic2any`** (npm, v0.0.4):

```typescript
import heic2any from 'heic2any'

// In imageResize.ts fileToBase64():
if (isHeic(file.type)) {
  const converted = await heic2any({ blob: file, toType: 'image/jpeg' })
  processFile(converted as Blob)
}
```

The converted JPEG blob is then processed through the canvas resize pipeline. Supported HEIC MIME types: `image/heic`, `image/heif`, `image/heif-compressed`.

### Image Resize — Canvas API

Image resizing uses the browser's native **Canvas API** (no extra library). The flow in `fileToBase64(file, maxSizeMB)`:

1. Load blob into `<img>`
2. If under `maxSizeMB`: encode directly at 85% JPEG quality
3. If over limit: calculate `scale = sqrt(targetBytes / currentBytes)`, draw to sized canvas, re-encode at 85% JPEG quality, iteratively reduce quality (step -0.1) until under size limit

### Haversine Formula

The Haversine formula calculates the great-circle distance between two GPS coordinates. It's implemented **server-side only** in `src/app/api/submit-menu/route.ts`:

```typescript
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
```

Called during `POST /api/submit-menu` geo-check. Distance must be ≤ 10 meters to pass. The client-side radius filter uses a simpler Euclidean approximation (not Haversine) for performance.

### Tailwind CSS Setup

**Tailwind CSS v4** is used (not v3). Configuration is entirely in CSS — no `tailwind.config.js` file exists. In `globals.css`:

```css
@import "tailwindcss";
```

PostCSS plugin: `@tailwindcss/postcss` (configured in `postcss.config.mjs`).

Key Tailwind classes used throughout the app:

| Class Pattern | Usage |
|---|---|
| `flex flex-col`, `flex-1`, `shrink-0` | Layout (full app uses Flexbox column layout) |
| `h-screen`, `w-full`, `max-w-md` | Sizing constraints |
| `bg-amber-500`, `text-amber-600`, `border-amber-500` | Brand color (amber/yellow palette) |
| `bg-white`, `text-gray-900`, `border-gray-200` | Neutral surfaces |
| `rounded-xl`, `rounded-full`, `rounded-2xl` | Border radius (large, pill, extra-large) |
| `shadow-lg`, `shadow-2xl` | Elevation |
| `z-10`, `z-40`, `z-50`, `z-[200]` | Stacking context for overlays |
| `fixed inset-0` | Full-screen overlays |
| `bottom-0`, `absolute bottom-0 left-0 right-0` | Bottom sheets |
| `overflow-y-auto`, `overflow-x-auto` | Scroll containers |
| `text-sm`, `text-xs`, `text-lg`, `font-bold` | Typography scale |
| `bg-purple-100`, `text-purple-700` | HH-active badge (purple) |
| `bg-green-50`, `text-green-600` | Success states |
| `bg-red-50`, `text-red-600` | Error states |
| `animate-spin` | Loading spinners |
| `transition-colors` | Hover transitions |

### Custom Hooks

One custom hook exists — `useOnboarding()` in `OnboardingModal.tsx`:

```typescript
export function useOnboarding(): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    try {
      if (!localStorage.getItem('pourlist_onboarding_seen')) {
        setSeen(true)
      }
    } catch {
      setSeen(true) // fail open
    }
  }, [])
  return seen
}
```

Returns `true` on first visit (onboarding should show), `false` thereafter. Read by `page.tsx` on mount to decide whether to open the modal.

### OpenAI SDK

The app uses the **`openai`** npm package (v6.33.0+) on the server side only (in API routes). It uses the `gpt-4o-mini` model for menu text extraction. The client never calls OpenAI directly — all AI requests go through `POST /api/parse-menu`. The SDK is initialized with the `OPENAI_API_KEY` environment variable.

```typescript
import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
```

### Rate Limit State Interface

`src/lib/rateLimit.ts` exports this TypeScript interface used throughout the client:

```typescript
export interface RateLimitState {
  allowed: boolean        // true = action permitted
  retryAfterMs?: number   // ms until next allowed action (if blocked)
}
```

---

## Quick Reference

```
GitHub:       github.com/xalanx2000x/pourlist
Supabase:     https://cuzkquenafzebdqbuwfk.supabase.co
Storage:      venue-photos (bucket)
Deploy:       Vercel (connected to GitHub main branch)
API Cost:     ~$0.0003 per menu photo (GPT-4o mini)
Map Cost:     $0 (free tier, 50k loads/mo)
DB Cost:      $0 (free tier)
Hosting Cost: $0 (Vercel free tier)
```

### Environment Variable Summary

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Client + Server | Map rendering |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | DB/Storage endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Supabase anon client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin DB access (RLS bypass) |
| `OPENAI_API_KEY` | Server only | GPT-4o mini menu parsing |
| `NEXT_PUBLIC_BASE_URL` | Server | Rate limit redirect URLs |
