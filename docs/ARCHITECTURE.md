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
├── app/                          # Next.js App Router pages
│   ├── page.tsx                  # Main home page (map + scan flow)
│   ├── admin/page.tsx            # Admin/moderation page
│   └── api/                      # API route handlers
│       ├── parse-menu/           # POST — GPT-4o mini menu OCR
│       ├── submit-menu/          # POST — create or update venue + menu
│       ├── upload-photo/         # POST — upload photo to Supabase Storage
│       ├── check-duplicate/      # POST — duplicate detection
│       ├── delete-old-photos/    # POST — photo retention cleanup
│       ├── rate-limit-check/     # POST — spam prevention
│       ├── track-event/          # POST — analytics events
│       └── create-venue/          # (planned) create a new venue directly
│       └── commit-menu/          # (planned) full commit: venue create + photo upload + photo_sets
│
├── components/                   # React components
│   ├── Map.tsx                   # Mapbox map with venue pins
│   ├── SearchBar.tsx             # Venue name / location search
│   ├── VenueList.tsx             # Scrollable venue list
│   ├── VenueDetail.tsx           # Bottom sheet: venue info + menu
│   ├── VenueCard.tsx              # List item for a single venue
│   ├── MenuCapture.tsx           # Camera/gallery photo picker (supports multi-photo)
│   ├── MenuConfirm.tsx            # Review parsed menu text + confirm save (being replaced)
│   ├── MenuReview.tsx             # (planned) replacement for MenuConfirm with HH time detection
│   ├── AddVenueForm.tsx          # Manual venue creation form (being simplified)
│   ├── VenuePicker.tsx            # (planned) "Are you at X?" screen after photo capture
│   ├── NameEntry.tsx              # (planned) name entry + fuzzy match for new venues
│   ├── OnboardingModal.tsx        # First-time user tour
│   └── SupportScreen.tsx          # Developer tip screen
│
└── lib/                          # Shared utilities
    ├── supabase.ts               # Supabase client + TypeScript types (Venue, Photo, Flag)
    ├── venues.ts                 # Venue CRUD helpers (getVenuesByProximity, addVenue, etc.)
    ├── gps.ts                    # EXIF GPS extraction + browser geolocation
    ├── device.ts                 # Device hash generation (anonymous identity)
    ├── geocode.ts                # Nominatim geocoding + venue search
    ├── happyHourCheck.ts         # HH signal detection from menu text
    ├── activeHH.ts               # Real-time HH active check (used for purple pin logic)
    ├── rateLimit.ts              # Client-side rate limiter (localStorage-based)
    ├── analytics.ts              # Event tracking helper
    ├── imageHash.ts              # File fingerprinting for dedup
    └── imageResize.ts            # Client-side image resizing before upload
```

---

## Key State Machine: `scanStep`

The main page (`page.tsx`) manages the scan/upload flow via a `scanStep` state machine:

```
idle
  │
  └── 'capture' → MenuCapture (take 1–4 photos + GPS)
                    │
                    ▼
              'confirm' → MenuConfirm (review parsed text + save)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
         (success)                      'newvenue' → AddVenueForm
         → idle                            │
                                           ▼
                                      (back to 'confirm'
                                       once venue created)
```

**Current `scanStep` values (as of this doc):**

| Value | Component shown | Trigger |
|-------|----------------|---------|
| `idle` | Map/list view | Default state |
| `capture` | `MenuCapture` | User taps "Scan Happy Hour Menu" button |
| `confirm` | `MenuConfirm` | After `MenuCapture` calls `onCapture` with photos + GPS |
| `newvenue` | `AddVenueForm` | No nearby venue found, user needs to create one |

**Planned `scanStep` values (after implementation):**

| Value | Component shown | Trigger |
|-------|----------------|---------|
| `idle` | Map/list view | Default state |
| `capture` | `MenuCapture` | User taps scan button |
| `venue_picker` | `VenuePicker` | GPS available, show "Are you at X?" |
| `name_entry` | `NameEntry` | No match in venue_picker, or no GPS |
| `review` | `MenuReview` | After parsing all photos |
| `newvenue` (or `confirm`) | `AddVenueForm` | Legacy path |

---

## Key API Routes

### `POST /api/parse-menu`

- **Input:** `{ imageData: string }` — base64 data URL of a photo
- **Model:** GPT-4o mini with vision
- **Prompt:** Extract all menu text verbatim from the photo. Preserve prices, drink names, times. Mark illegible text as `[illegible]`.
- **Output:** `{ text: string }` — raw extracted text
- **Timeout:** 30 seconds
- **Rate limit:** Uses device hash to limit parse requests

### `POST /api/submit-menu`

- **Input:** `{ menuText, venueId?, venueName, address, lat?, lng?, deviceHash, imageUrl? }`
- **Creates** a new venue if `venueId` is not provided
- **Updates** `menu_text` on an existing venue if `venueId` is provided
- **Geo-check:** If photo GPS is provided and venue has coords, verifies photo location is within **10m** of venue
- **Sanitization:** HTML-escapes `menu_text` before storing to prevent XSS
- **Output:** `{ venueId: string, success: true }`

### `POST /api/upload-photo`

- **Input:** `FormData` with `photo` (File), `venueId?`, `deviceHash`, `lat?`, `lng?`
- **Uploads** to Supabase Storage under `venue-photos/{filename}`
- **Retention:** After upload, calls `cycle_old_photos` RPC to keep only the 3 most recent photos per venue
- **Output:** `{ url: string, fingerprint: string, lat: number|null, lng: number|null }`

---

## Authentication

**No user accounts.** Anonymous device fingerprinting:

```ts
// src/lib/device.ts — getDeviceHash()
const fingerprint = [
  navigator.userAgent,
  navigator.language,
  screen.width, screen.height, screen.colorDepth,
  new Date().getTimezoneOffset()
].join('|')
// Simple hash → 'device_xxxxx'
```

- Stored in Supabase as `uploader_device_hash` on photos and `deviceHash` on submissions
- Used for rate limiting (client-side in `rateLimit.ts` + server-side in each API route)
- Not linked to any personally identifiable information

---

## Data Model (TypeScript types from `supabase.ts`)

```ts
// src/lib/supabase.ts

type Venue = {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  zip: string | null
  phone: string | null
  website: string | null
  type: string | null
  status: 'unverified' | 'verified' | 'stale' | 'closed'
  contributor_trust: string      // 'new' | 'trusted' | 'anonymous'
  last_verified: string | null
  photo_count: number
  created_at: string
  menu_text: string | null
  menu_text_updated_at: string | null
  latest_menu_image_url: string | null
}

type Photo = {
  id: string
  venue_id: string
  url: string
  uploader_device_hash: string
  lat: number | null
  lng: number | null
  status: 'pending' | 'approved' | 'rejected'
  flagged_count: number
  moderation_confidence: number | null
  created_at: string
}

type Flag = {
  id: string
  venue_id: string | null
  photo_id: string | null
  reason: string
  device_hash: string
  created_at: string
}
```

**Note on `photo_sets`:** The spec calls for a `photo_sets` table to store grouped submissions. This table **does not yet exist in the codebase** — the current implementation stores photos individually and manages retention via the `cycle_old_photos` Supabase RPC. The `photo_sets` table is planned for a future migration.

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