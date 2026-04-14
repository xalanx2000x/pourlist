# The Pour List — Complete Project Summary
**Generated:** 2026-04-14 00:00 PDT
**Repo:** https://github.com/xalanx2000x/pourlist
**Live:** https://pourlist.vercel.app

---

## 1. What It Is

The Pour List is a crowd-sourced happy hour directory. Users photograph a bar/restaurant's happy hour menu with their phone camera, GPT-4o mini extracts the text, and the parsed menu is stored permanently — the photo itself is discarded after parsing. No accounts. Anonymous device hash for spam prevention. Starts with Portland's Pearl District (97209), designed to scale nationally.

**Stack:**
- Frontend: Next.js 16 (App Router), Tailwind CSS v4, TypeScript
- Backend: Next.js API Routes
- Database: Supabase PostgreSQL + Storage
- Maps: Mapbox GL JS
- AI: OpenAI GPT-4o mini (menu text extraction, ~$0.0003/photo)
- Geocoding: Mapbox (primary) + Nominatim OSM (fallback)
- PWA: Service worker, manifest, offline-capable

---

## 2. Environment Variables

All stored in `.env.local` (gitignored — never commit):

```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...         # Mapbox GL JS public token
NEXT_PUBLIC_SUPABASE_URL=https://cuzkquenafzebdqbuwfk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
OPENAI_API_KEY=sk-proj-...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

---

## 3. Database Schema (Supabase)

**Project URL:** https://cuzkquenafzebdqbuwfk.supabase.co
**Storage:** `venue-photos` bucket (public), two policies: anon SELECT and INSERT

### `venues` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Auto-generated |
| `name` | text NOT NULL | Venue name |
| `address` | text | Street address (optional — GPS is primary) |
| `lat` | double precision | GPS latitude (null = no pin on map) |
| `lng` | double precision | GPS longitude |
| `zip` | text |_nullable — no longer hardcoded to 97209 |
| `phone` | text | Optional |
| `website` | text | Optional |
| `type` | text | e.g. "Bar", "Restaurant" |
| `status` | text | `'unverified' \| 'verified' \| 'stale' \| 'closed'` |
| `contributor_trust` | text | `'new' \| 'trusted' \| 'anonymous'` |
| `last_verified` | timestamptz | |
| `photo_count` | int | |
| `created_at` | timestamptz | Default `now()` |
| `menu_text` | text | HH menu content |
| `menu_text_updated_at` | timestamptz | |
| `latest_menu_image_url` | text | |
| `address_normalized` | text | Canonical single-line address (planned) |

**Status lifecycle:** `unverified → verified → stale → closed`
- `unverified`: newly created by community contribution
- `verified`: manually confirmed to exist and have a HH program
- `stale`: menu_text hasn't been updated in a long time
- `closed`: venue no longer operating

### `photos` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `venue_id` | uuid FK → venues | |
| `url` | text NOT NULL | Supabase Storage URL |
| `uploader_device_hash` | text NOT NULL | Anonymous device fingerprint |
| `lat` | double precision | GPS from EXIF — stored for geo-check |
| `lng` | double precision | |
| `status` | text | `'pending' \| 'approved' \| 'rejected'` |
| `flagged_count` | int | |
| `moderation_confidence` | double precision | |
| `created_at` | timestamptz | |

**Photo retention:** 3 most recent photos per venue via `cycle_old_photos()` RPC

### `photo_sets` table (NEW — built 2026-04-13)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `venue_id` | uuid FK → venues ON DELETE CASCADE | |
| `created_at` | timestamptz | Default `now()` |
| `photo_urls` | text[] | Array of Supabase Storage URLs |

- Index: `idx_photo_sets_venue_created` on `(venue_id, created_at DESC)`
- Retention: last 4 photo sets per venue; oldest purged on 5th submission
- `menu_text` always reflects most recent submission

### `flags` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `venue_id` | uuid FK (nullable) | |
| `photo_id` | uuid FK (nullable) | |
| `reason` | text NOT NULL | |
| `device_hash` | text NOT NULL | |
| `created_at` | timestamptz | |

### `rate_limits` table

| Column | Type | Notes |
|--------|------|-------|
| `device_hash` | text PK (composite) | |
| `action` | text PK (composite) | |
| `count` | int | |
| `window_start` | timestamptz | |

### `events` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `event_name` | text NOT NULL | e.g. `'menu_save_success'` |
| `device_hash` | text NOT NULL | |
| `venue_id` | uuid FK (nullable) | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

---

## 4. Row Level Security (RLS) Policies

**Current policies (as of 2026-04-13):**

```sql
-- venues
Public read venues     → SELECT, public, qual=true
Constrained insert venues → INSERT, public, with_check: contributor_trust IS NOT NULL AND non-empty

-- photos
Public read photos     → SELECT, public, qual=true
Constrained insert photos → INSERT, public, with_check: uploader_device_hash IS NOT NULL AND non-empty

-- photo_sets
photo_sets_public_read → SELECT, public, qual=true
photo_sets_insert     → INSERT, public, with_check: true  (OPEN - noted in security audit)
```

**UPDATE and DELETE on venues were removed** (they were fully open).

**Intent:** All writes go through API routes using the service role key (bypasses RLS). RLS is defense-in-depth against direct Supabase access with the exposed anon key.

---

## 5. API Surface

All routes live in `src/app/api/`. Responses are JSON; errors are `{ error: string }` with generic client-facing messages ("Internal server error"). No raw error messages are returned to clients.

### `POST /api/parse-menu`
Sends photo to GPT-4o mini for menu text extraction.

```ts
// Request (body JSON):
{ imageData: string }          // base64 data URL (preferred)
// OR
{ imageUrl: string }           // Supabase Storage URL (fallback)

// Response:
{ text: string }               // extracted menu text

// Errors: 400 (missing), 429 (rate limit), 500 (server error)
```

- Rate limit: 30/hr/device
- Timeout: 30s via AbortController
- Parses all photos in parallel per session
- No error details leaked to client

---

### `POST /api/upload-photo`
Uploads a single photo to Supabase Storage.

```ts
// Request: multipart/form-data
photo: File
venueId?: string
deviceHash: string
lat?: number
lng?: number
fingerprint: string   // "${size}-${name}-${lastModified}"

// Response:
{ url: string, fingerprint: string, lat: number, lng: number }
```

- Max 20MB per file
- MIME allowlist: `['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/heif-compressed']`
- Filenames generated server-side: `randomUUID() + '.' + sanitized extension`
- Calls `cycle_old_photos()` after insert
- Rate limit: 10/hr/device

---

### `POST /api/submit-menu`
Creates a new venue or updates an existing one with menu text.

```ts
// Request:
{
  menuText: string             // HTML-escaped before storage, max 10,000 chars
  venueId?: string             // omit to create new venue
  venueName: string            // required if no venueId
  address?: string             // optional
  lat?: number
  lng?: number
  deviceHash: string
  photoUrl?: string
  photoLat?: number
  photoLng?: number
}

// Response:
{ venueId: string, success: true }
```

- Geo-check (10m Haversine) required if photo GPS provided
- New venues: `zip: null` (no longer hardcoded to 97209)
- Status: `unverified` for new contributors
- Rate limit: 20/hr/device

---

### `POST /api/create-venue` (NEW)
Creates a new venue record without any menu text.

```ts
// Request:
{
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  deviceHash: string
}

// Response:
{ venue: Venue }
```

- GPS is primary location signal; address is optional display sugar
- No geocoding required at submission time

---

### `POST /api/commit-menu` (NEW)
Full commit: venue create/update + photo set upload + menu text save + photo set retention management.

```ts
// Request:
{
  venueId: string | null       // null = create new venue
  newVenueName?: string        // set if venueId is null
  gps: { lat: number; lng: number } | null
  menuText: string
  hhTime: string               // detected time pattern, e.g. "4-6pm, daily"
  photoUrls: string[]          // URLs after upload via /api/upload-photo-set
}

// Actions:
// 1. If venueId is null → create new venue via /api/create-venue
// 2. INSERT new photo_set row
// 3. DELETE oldest photo_set if count > 4
// 4. Update venue: menu_text, latest_menu_image_url, menu_text_updated_at

// Response:
{ success: true, venueId: string }
```

- Auth check: trusted venues only updatable by original contributor (matching deviceHash)
- New/anonymous venues: open for community editing
- All update attempts logged server-side

---

### `POST /api/check-duplicate`

```ts
// Request: { deviceHash: string, fingerprint: string, venueId?: string }
// Response: { isDuplicate: true }   ← NO venueId or menuText returned
```

Only returns a boolean. No venue ID or menu text leaked on duplicate match.

---

### `POST /api/rate-limit-check`

```ts
// Request: { action: 'parse-menu' | 'submit-menu' | 'upload-photo', deviceHash: string }
// Response: { allowed: true | false }
```

Server-side enforcement. 429 responses use generic message: "Too many requests. Please wait a moment before trying again."

---

### `POST /api/track-event`

```ts
// Request: { event: string, deviceHash: string, metadata?: object }
// Response: { ok: true }
```

Fire-and-forget. Errors are logged server-side (`console.error`) but never shown to client.

---

## 6. Upload Flow (New — built 2026-04-13)

The complete scan-and-add flow. Replaces the old `capture → confirm` two-step with a 4-step flow.

### State Machine (scanStep in page.tsx)

```
idle
  │ tap "Scan Happy Hour Menu"
  ▼
capture (MenuCapture)
  │ 1–4 photos + GPS from EXIF or browser
  │ tap "Done"
  ▼
venue_picker (VenuePicker)       ← GPS available
  │ 10m proximity query
  │ "Are you at X?" → Yes/No/"None of these"
  ▼ or │
name_entry (NameEntry)           ← no GPS or "None of these"
  │ type name, fuzzy match at 2+ chars
  │ "Did you mean X?" → Yes/No
  │ "Create [name]" always visible as fallback
  ▼ or │
parse photos (parallel GPT-4o mini)
  │ combine text from all photos
  │ checkHappyHour() → times[], isNotHH
  ▼
review (MenuReview)
  │ HH time field (editable, pre-filled by parser)
  │ Menu text box (editable)
  │ isNotHH = true → error state: "Try Again" → back to capture
  │ "Commit" → commit-menu API
  │ "Discard" → return to map, nothing saved
```

### Venue Picker (`VenuePicker.tsx`)

- Queries `getVenuesByProximity(gps.lat, gps.lng, 10)` — 10 meter radius
- 0 results → fires `onVenueNotListed()` → proceeds to name_entry
- 1 result → "Are you at [Name]?" with address snippet, Yes/No buttons
- 2+ results → list sorted by distance, "None of these" at bottom
- "Yes" → `onVenueConfirmed(venue)` → proceeds to parse → review

### Name Entry (`NameEntry.tsx`)

- Debounced fuzzy search fires after 2+ characters
- Query: `name ILIKE '%input%'` with lat/lng sort when GPS available
- Match within ~5km → "Did you mean: [Name] [address] [distance]?" with Yes/No
- "Yes" → `onVenueMatched(venue)` → proceeds to parse → review
- No match or "No" → "Create [name]" button always visible → `onVenueCreated(name)` → parse → review

### Menu Review (`MenuReview.tsx`)

- Read-only photo strip (thumbnails)
- HH time field: pre-filled by parser with matched time substrings, fully editable
- Menu text box: pre-filled, editable `<textarea>`
- No HH detected → error state: *"No happy hour times found. Make sure you're uploading a happy hour menu and try again with better lighting."* → "Try Again" button → returns to capture
- "Commit" → `onCommit(menuText, hhTime)` → full commit handler
- "Discard" → return to map, nothing created

### Happy Hour Detection (`checkHappyHour()` in `happyHourCheck.ts`)

- Returns `{ isHappyHour: boolean, times: string[] }` where `times` are the specific matched time substrings (e.g., `["4-6pm", "daily"]`)
- Raw text only — not re-run after user edits
- HH time field shows `times.join(', ')` pre-filled, user can edit freely

### Photo Sets

- Each scan session creates one photo set
- `photo_sets` table tracks the grouping
- On 5th submission: oldest set deleted (by `created_at`)
- `menu_text` always reflects most recent submission

---

## 7. Components

### `Map.tsx`
Mapbox GL JS map. Purple = active HH right now, amber = verified, yellow = unverified, orange = stale. Clusters at zoom-out. Fly-to on venue select.

### `SearchBar.tsx`
Search by venue name (Supabase) or location (Nominatim). Falls back to geocoding if no venue match.

### `VenueList.tsx` / `VenueCard.tsx`
Scrollable list. HH count in header. Purple badge for active HH venues.

### `VenueDetail.tsx`
Bottom sheet on pin tap. Name, address, phone, website, menu text, photo, Google/Yelp links, HH badge.

### `MenuCapture.tsx` (enhanced 2026-04-13)
- 1–4 photos per session
- "Add another photo" slot visible while < 4
- EXIF GPS extraction from first photo → browser fallback
- Thumbnail strip with ✕ remove per photo
- "Done" button enabled when ≥1 photo captured
- GPS: `{ lat, lng } | null` passed to parent

### `MenuConfirm.tsx` (deprecated)
Old review screen. Still in codebase but off the new scan flow path.

### `MenuReview.tsx` (new)
Replacement for MenuConfirm. HH time field + editable menu text + no-HH error state.

### `VenuePicker.tsx` (new)
"Are you at X?" screen. 10m proximity query. Yes/No/None of these.

### `NameEntry.tsx` (new)
Name-only entry with fuzzy match and "Did you mean X?" prompt.

### `AddVenueForm.tsx` (simplified)
Name-only. No geocode call. Still available for manual add from map screen.

### `SupportScreen.tsx`
Bottom sheet with Cash App (`$heretothere23`) and Venmo (`@tymyry`) payment links. Tip suggestion: $1.

### `OnboardingModal.tsx`
3-step first-run tour. Shown once, stored in `localStorage`.

---

## 8. Library Files

### `src/lib/supabase.ts`
Supabase client + TypeScript types: `Venue`, `Photo`, `Flag`.

### `src/lib/venues.ts`
`getVenuesByZip()`, `getVenuesByProximity()` (Haversine-filtered), `getVenueById()`, `addVenue()`, `getVenuePhotos()`, `submitPhoto()`, `flagContent()`, `createVenueForScan()`, `addPhotoSet()`, `getPhotoSets()`.

### `src/lib/device.ts`
`getDeviceHash()` — non-cryptographic browser fingerprint (UA + language + screen + color depth + timezone). **Known weakness: spoofable.** Deferred fix.

### `src/lib/gps.ts`
`extractGpsFromPhoto()` (ExifReader library), `getBrowserLocation()` (navigator.geolocation with 5s timeout, high accuracy).

### `src/lib/geocode.ts`
`reverseGeocode()` (Mapbox primary → Nominatim fallback), `geocodeAddress()` (Nominatim forward geocode, extracts zip).

### `src/lib/happyHourCheck.ts`
`checkHappyHour(text)` — scans for time patterns, returns `{ isHappyHour, signals }`. Extended 2026-04-13 to return `times: string[]` with matched substrings for MenuReview.

### `src/lib/activeHH.ts`
`hasActiveHappyHour(menuText)` — time-aware. Checks current hour + day against time windows in menu text. Used for purple pin coloring.

### `src/lib/rateLimit.ts`
Client-side sliding window: unlimited first 2 minutes, then 1 per 2 minutes. **Bypassable — acknowledged.** Server-side enforcement is authoritative.

### `src/lib/analytics.ts`
`trackEvent()` → POST /api/track-event. Fire-and-forget.

### `src/lib/imageHash.ts`
`fingerprintFile()` — `${size}-${name}-${lastModified}`. Not perceptual hash.

### `src/lib/imageResize.ts`
`fileToBase64(file, maxSizeMB)` — HEIC→JPEG conversion via `heic2any`, canvas resize, iterative JPEG quality reduction.

### `src/lib/addresses.ts` (new)
`normalizeAddress(rawAddress: string)` — converts full address to canonical "5627 S Kelly Ave" format (number + direction + name + type, no city/state/zip). Portland-centric abbreviations. No USPS API.

---

## 9. Security Model

**Current state (2026-04-13):**

| Issue | Status |
|-------|--------|
| Anon key exposed in client JS | Acknowledged — RLS is defense-in-depth |
| deviceHash is spoofable | Acknowledged — deferred to auth layer work |
| Client-side rate limiter bypassable | Acknowledged — server-side is authoritative |
| Venues UPDATE/DELETE fully open | **FIXED** — policies removed |
| Error messages leaked to clients | **FIXED** — all return generic "Internal server error" |
| MIME type not validated on upload | **FIXED** — allowlist enforced |
| User input in filename | **FIXED** — randomUUID() server-side |
| check-duplicate leaked venueId + menuText | **FIXED** — returns boolean only |
| commit-menu had no auth | **FIXED** — trusted venues require original contributor deviceHash |
| Hardcoded zip 97209 | **FIXED** — new venues get `zip: null` |
| photo_sets INSERT policy is `true` | Open — acceptable for now, needs server-side write tokens to fix properly |
| GPS stored in photos table | Intentionally kept — required for geo-check |

**RLS summary:**
- venues: SELECT (public), INSERT (hash-gated), UPDATE (removed), DELETE (removed)
- photos: SELECT (public), INSERT (hash-gated)
- photo_sets: SELECT (public), INSERT (open — noted)

---

## 10. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| GPS + name as primary dedup signal | "Jolly Rodger at 45.4828, -122.685" is unique regardless of address formatting |
| Address optional, display sugar | No hard dependency on geocoding to create venues |
| Photos ephemeral, menu_text permanent | Privacy + no image hosting costs + immediately useful data |
| No user accounts | Device hash is anonymous spam prevention, not surveillance |
| Link to Google/Yelp | Zero moderation burden |
| Bottom sheets on mobile | Context never lost, map always visible |
| 4 photo sets per venue | Enough for multi-page menus, cap prevents bloat |
| GPT-4o mini for parsing | $0.0003/photo — effectively free at scale |
| Mapbox over Google Maps | Free tier sufficient (50k loads/mo) |
| Nominatim for geocoding | Free, no API key |
| Purple = active HH | Distinct from amber unverified markers |

---

## 11. Seed Data

61 Pearl District (97209) venues seeded from OpenStreetMap Overpass API. No city/state expansion has occurred yet. Zip is no longer hardcoded — future seeding will leave `zip: null` or set correctly from geocoding.

---

## 12. Donation / Support

`SupportScreen.tsx` shows Cash App `$heretothere23` and Venmo `@tymyry`. Both accounts set to private. Suggested tip: $1.

---

## 13. Running the Project

```bash
cd /Users/livingroom/.openclaw/workspace/pourlist
npm run dev    # → localhost:3000
```

Vercel deploys from `origin/main` automatically.

---

## 14. Open Items

- deviceHash replacement with server-issued tokens — deferred
- photo_sets INSERT policy hardening — deferred
- Perceptual hashing (pHash) — not implemented; using file size fingerprint
- Image moderation pipeline — not implemented
- pg_cron unavailable — cleanup runs inline in API routes
- No perceptual/visual duplicate detection

---

_This document is the authoritative source for project state as of 2026-04-14. It supersedes all prior status and summary documents._