# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router, TypeScript strict mode) |
| **Database** | Supabase (PostgreSQL) |
| **Storage** | Supabase Storage (venue-photos bucket) |
| **Maps** | Mapbox GL JS |
| **AI Parsing** | GPT-4o mini (OpenAI) — parses menu photos into text |
| **Styling** | Tailwind CSS (via globals.css + inline classes) |
| **Auth** | None — anonymous device hashing (no accounts) |

---

## Directory Structure

```
src/
├── app/
│   ├── page.tsx                  # Main home page (map + scan flow + state machine)
│   ├── layout.tsx                # Root layout with fonts, global styles
│   └── api/
│       ├── parse-menu/           # POST — GPT-4o mini menu OCR
│       ├── submit-venue/         # POST — new venue: dedup + create + photos (single-step)
│       ├── commit-menu/          # POST — existing venue: update HH + photos
│       ├── upload-photo/         # POST — upload to Supabase Storage
│       ├── flag/                 # POST — GPS-verified flag (moderation)
│       ├── confirm/              # POST — GPS-verified confirm (moderation)
│       ├── cron/decay-flags/     # POST — monthly flag decay
│       ├── rate-limit-check/    # POST — spam prevention
│       ├── track-event/          # POST — analytics events
│       └── create-venue/         # Legacy — old two-step path (deprecated)
│
├── components/
│   ├── Map.tsx                   # Mapbox map with venue pins + bounds filtering
│   ├── SearchBar.tsx             # Venue name / location geocoding search
│   ├── VenueList.tsx             # Scrollable list (filtered by last active map bounds)
│   ├── VenueDetail.tsx          # Bottom sheet: HH schedule + menu photo + actions
│   ├── VenueCard.tsx             # List item for a single venue
│   ├── MenuCapture.tsx           # Camera/gallery picker (exifGps + phoneGps extraction)
│   ├── VenuePicker.tsx           # "Are you at X?" — confirm against nearby venues
│   ├── NameEntry.tsx             # New venue name entry + fuzzy Supabase match
│   ├── MenuReview.tsx            # Edit HH schedule + commit
│   ├── HHScheduleInput.tsx       # Two-box HH parser with live preview
│   ├── HHScheduleEditor.tsx      # (planned) manual HH window editor
│   ├── OnboardingModal.tsx       # First-time user tour
│   └── SupportScreen.tsx         # Developer tips screen
│
└── lib/
    ├── supabase.ts               # Supabase client + Venue type (with hh_* fields)
    ├── venues.ts                 # getVenuesByProximity, getVenueById, addVenue
    ├── parse-hh.ts               # Parse HH schedule text → structured HHWindow[]
    ├── parse-menu.ts             # AI menu text extraction (parseMenuPhotos)
    ├── gps.ts                    # extractGpsFromPhoto (EXIF) + getBrowserLocation
    ├── gpsCheck.ts               # Haversine helpers: isWithinRadius, haversineDistance
    ├── device.ts                 # getDeviceHash() — anonymous device fingerprint
    ├── geocode.ts                # Nominatim geocoding + reverse geocoding
    ├── activeHH.ts               # isHHActive(venue) — checks hh_* fields against clock
    ├── happyHourCheck.ts         # checkHappyHour(text) → boolean (pre-filter)
    ├── rateLimit.ts              # Client-side rate limiter (localStorage-based)
    ├── analytics.ts              # trackEvent(), trackVenueEvent()
    └── imageHash.ts              # File fingerprinting for dedup
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (publishable) key |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox GL JS access token |
| `NEXT_PUBLIC_BASE_URL` | App base URL (e.g. `http://localhost:3000`) |
| `OPENAI_API_KEY` | OpenAI API key (server-only, for `/api/parse-menu`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only, for admin ops) |

---

## State Machine: `scanStep`

The main `page.tsx` manages the scan/upload flow via a `scanStep` state machine. GPS signal separation: `exifGps` (from photo EXIF — authoritative) vs `phoneGps` (browser location — fraud signal only).

```
idle
  │
  └── 'capture'     → MenuCapture (take 1–4 photos)
                           │
                           ▼ (if no venue pre-selected)
                    'venue_picker' → VenuePicker
                           │                        │
              ┌────────────┘                        │
              ▼                                     ▼
         'name_entry' ←─────────────── (no match or "not here")
              │
              ▼
           'review' → MenuReview (edit HH schedule, commit)
                              │
                              ▼
                          idle (resetScan)
```

| Step | Component shown | Trigger |
|------|-----------------|---------|
| `idle` | Map/list view | Default state |
| `capture` | `MenuCapture` | User taps "Scan Happy Hour Menu" |
| `venue_picker` | `VenuePicker` | GPS available, no pre-selected venue |
| `name_entry` | `NameEntry` | "I'm not here" or no GPS |
| `review` | `MenuReview` | Photos captured, menu text parsed |

---

## GPS Signal Separation

Two distinct GPS signals are tracked throughout the scan flow:

| Signal | Source | Used for | Stored on venue? |
|--------|--------|----------|-----------------|
| `exifGps` | First photo's EXIF metadata | Authoritative venue location | **Yes** (`lat`/`lng`) |
| `phoneGps` | Browser's `getCurrentPosition()` | Fraud signal only | **No** — logged to `venue_events` if >500m from venue |

This prevents indoor/low-accuracy phone GPS from overriding the photo's EXIF GPS, which was captured at the venue by the user.

---

## Data Model (TypeScript types from `supabase.ts`)

```ts
type Venue = {
  id: string
  name: string
  address_backup: string   // preserved from old address column, phased out
  lat: number | null
  lng: number | null
  zip: string | null
  phone: string | null
  website: string | null
  type: string | null
  status: 'unverified' | 'verified' | 'stale' | 'closed'
  contributor_trust: 'new' | 'trusted'
  last_verified: string | null
  last_flag_decay_at: string | null
  photo_count: number
  created_at: string
  menu_text: string | null           // HTML-escaped, legacy — now superseded by hh_* fields
  menu_text_updated_at: string | null
  latest_menu_image_url: string | null
  // Structured HH windows (up to 3)
  hh_summary: string | null           // Raw text: "5pm-midnight daily"
  hh_type: string | null             // 'typical' | 'all_day' | 'open_through' | 'late_night'
  hh_days: string | null             // Comma-separated: "1,2,3,4,5"
  hh_start: number | null             // Minutes from midnight (e.g. 1020 = 5pm)
  hh_end: number | null
  hh_type_2, hh_days_2, hh_start_2, hh_end_2: ...
  hh_type_3, hh_days_3, hh_start_3, hh_end_3: ...
}

type PhotoSet = {
  id: string
  venue_id: string
  photo_urls: string[]                // Array of Supabase Storage public URLs
  uploader_device_hash: string
  created_at: string
}

type VenueEvent = {
  id: string
  venue_id: string | null
  event_type: 'gps_mismatch' | 'photo_upload' | 'hh_confirm' | ...
  device_hash: string
  lat: number | null
  lng: number | null
  created_at: string
}

type DeviceStats = {
  device_hash: string                 // Primary key
  submission_count: number
  updated_at: string
}

type Flag = {
  id: string
  venue_id: string | null
  photo_id: UUID | null               // Legacy — photos table deprecated in favor of photo_sets
  reason: string
  device_hash: string
  active: boolean                      // false = cleared by confirm or decay
  lat: number | null
  lng: number | null
  created_at: string
}

type VenueFlagEvent = {
  id: string
  venue_id: string
  device_hash: string
  action: 'flag' | 'confirm' | 'reopen'
  created_at: string
  // UNIQUE(venue_id, device_hash, action) — enforces idempotency
}
```

---

## Key Implementation Notes

### hh_* fields (2026-04-22+)

Happy hour data is stored as structured fields (`hh_type`, `hh_start`, `hh_end`, `hh_days`, etc.) rather than parsed from `menu_text`. Up to 3 windows supported:

- `hh_type`: `typical` | `all_day` | `open_through` | `late_night`
- `hh_days`: comma-separated day numbers (1=Mon, 7=Sun)
- `hh_start` / `hh_end`: minutes from midnight (e.g. 1020 = 5pm, 0 = midnight)
- `hh_summary`: raw user input text as fallback display

### Photo sets (replaces individual photos)

Photos are stored as **photo sets** — all photos from one scan session grouped together. Each venue keeps the **last 4 photo sets** (oldest deleted on new insert). Storage files are also deleted on purge.

### Moderation: GPS-verified flagging

Flagging and confirming require the user's GPS to be within **10m** (Haversine) of the venue. Flag decay removes one oldest active flag per venue per month. Devices with a `reopen` event cannot reflag.

### Symmetric map/list filtering

When the user pans the map, both the map pins and the list view are filtered to the same map bounds. "Search this area" resets bounds to `null` (shows all loaded venues).

### Active HH detection

`isHHActive(venue)` checks the structured `hh_type`/`hh_start`/`hh_end`/`hh_days` fields against the current clock and day-of-week. Replaced the old `menu_text` parsing approach.

### Rate limiting

Client-side (localStorage) + server-side (Supabase). Server-side is **fail-open** — if it fails, the request proceeds. Client-side fails fast with a user-visible message.

---

## Vercel Deployment

- **Production:** `pourlist.vercel.app` (CNAME to Vercel)
- **Preview deploys:** Each git push creates a preview URL
- **Cron job:** `/api/cron/decay-flags` runs monthly via Vercel's cron (frequency: `"30 3 1 * *"` — 3:30 AM on the 1st of each month)