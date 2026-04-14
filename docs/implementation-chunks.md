# Pour List Upload Flow — Implementation Chunks

These are ordered by dependency. Complete each chunk fully before moving to the next. If you have questions, surface them at the end of the chunk rather than abandoning the work.

---

## CHUNK 1: Database Schema + Storage Setup

**Goal:** Set up the data model to support photo sets and address normalization.

**Files to modify:**
- `supabase/migrations/schema.sql` — add migrations

**Changes:**

1. **Add `photo_sets` table:**
   ```sql
   CREATE TABLE photo_sets (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ DEFAULT now(),
     photo_urls TEXT[] -- array of Supabase Storage URLs
   );
   ```
   - Index on `(venue_id, created_at DESC)` for efficient retrieval of recent sets
   - Enable Row Level Security: users can insert; public read OK

2. **Add `latest_menu_image_url` column to `venues`** if not already present (should exist from prior fix — verify)

3. **Update `venues` table:** add `address_normalized` column (text, nullable) — the canonical single-line address for display

4. **Create `venue-photos` Storage bucket** in Supabase dashboard or via migration:
   - Public bucket named `venue-photos`
   - Path pattern: `venue-photos/{venue_id}/{photo_set_id}/{filename}`

5. **Write a `normalizeAddress(rawAddress: string): string` utility** in `src/lib/addresses.ts`:
   - Takes a free-form address string (e.g., "5627 S Kelly Avenue, Portland, OR 97239")
   - Returns canonical format: "5627 S Kelly Ave" (number + direction + name + type, no city/state/zip)
   - Abbreviations: Ave→Ave, St→St, Blvd→Blvd, Dr→Dr, Ln→Ln, NW/NE/SE/SW preserved, N/S/E/W preserved, ordinals (1st, 2nd) preserved
   - If can't parse: return the input unchanged
   - No USPS API call — just string parsing + known component removal

**Exit criteria:** Schema applied to Supabase, `normalizeAddress()` passes unit tests for known Portland address patterns.

---

## CHUNK 2: MenuCapture — Multi-Photo Camera

**Goal:** Replace or extend the current `MenuCapture` component to support 1–4 photos per session.

**Files to modify/create:**
- `src/components/MenuCapture.tsx`

**Changes:**

1. **Current `MenuCapture` allows 1 photo.** Extend to allow up to 4.

2. **UI requirements:**
   - Show thumbnail strip of captured photos at the bottom (max 4 slots)
   - Each thumbnail has an ✕ to remove it
   - "Add another photo" button (camera icon) visible while < 4 photos
   - GPS: extract from EXIF of first photo if present; otherwise call `getBrowserLocation()` as fallback. If neither available, `gps: null` is fine — pass null forward.
   - "Done" button (enabled when ≥1 photo captured) → proceed to next step

3. **GPS extraction from EXIF:**
   - Use `exifr` library (check if already installed; `npm install exifr` if not)
   - Parse GPS data from photo blob before upload
   - If GPS found in EXIF, use it; otherwise fall back to `getBrowserLocation()`

4. **Prop change:** `onCapture(files: File[], gps: {lat, lng} | null)` stays the same signature — caller receives all files at once

**Exit criteria:** User can capture 1–4 photos, GPS extracted, thumbnails shown, removal works, "Done" passes all files + GPS to parent.

---

## CHUNK 3: Venue Picker — "Are you at X?" Screen

**Goal:** Build the screen that appears after photo capture when GPS is available.

**Files to create:**
- `src/components/VenuePicker.tsx`

**UI:**

```
┌─────────────────────────────┐
│  ✕                    [back] │
│                             │
│  📷 [thumb1] [thumb2] [+]    │  ← photo strip (read-only)
│                             │
│  Are you at this venue?     │
│                             │
│  ┌───────────────────────┐  │
│  │ 🏠 Jolly Rodger       │  │
│  │    5627 S Kelly Ave   │  │
│  │                       │  │
│  │  ✓ Yes, that's me     │  │
│  │  ✗ No, I'm not here   │  │
│  └───────────────────────┘  │
│                             │
│  [if multiple within 10m]   │
│  ┌───────────────────────┐  │
│  │ Venue A  •  12m away  │  │
│  │ Venue B  •   8m away  │  │
│  │ ─────────────────────  │  │
│  │ None of these         │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Behavior:**

- On mount (if `gps != null`): call `getVenuesByProximity(gps.lat, gps.lng, 10)` (10 meters)
- **0 results →** no UI shown; immediately proceed to Step 4 (NameEntry) — emit `onNoNearbyVenue()`
- **1 result →** show single venue card with "Yes / No"
- **2+ results →** show venue cards sorted by distance + "None of these" option at bottom
- "Yes" on any venue → emit `onVenueConfirmed(venue)` → proceed to Step 5 (MenuReview)
- "None of these" or "No, I'm not here" → emit `onVenueNotListed()` → proceed to Step 4

**Props:**
```ts
interface VenuePickerProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  onVenueConfirmed: (venue: Venue) => void
  onVenueNotListed: () => void
  onClose: () => void
}
```

**Exit criteria:** Correct venue shown for GPS location; Yes/No/None flow works; 0 nearby → triggers correct callback.

---

## CHUNK 4: Name Entry — Fuzzy Match + "Did you mean?"

**Goal:** Replace `AddVenueForm` with a streamlined name-entry screen that queries existing venues as the user types.

**Files to create:**
- `src/components/NameEntry.tsx`

**UI:**

```
┌─────────────────────────────┐
│  ✕                    Back │
│                             │
│  New venue                  │
│                             │
│  ┌───────────────────────┐  │
│  │ Venue Name             │  │
│  └───────────────────────┘  │
│                             │
│  (below input, appears      │
│   after user types 2+ chars │
│   and match found)          │
│                             │
│  Did you mean:               │
│  ┌───────────────────────┐  │
│  │ Jolly Rodger          │  │
│  │ 5627 S Kelly Ave  •8m │  │
│  │         [Yes] [No]    │  │
│  └───────────────────────┘  │
│                             │
│  ─── or ───                 │
│                             │
│  [ Create "Jolly Rodger" ]  │  ← always visible as fallback
└─────────────────────────────┘
```

**Behavior:**

1. User types in name field
2. After **≥2 characters**, query Supabase:
   ```sql
   SELECT id, name, address, lat, lng
   FROM venues
   WHERE name ILIKE '%' || $1 || '%'
     AND lat IS NOT NULL AND lng IS NOT NULL
   LIMIT 5
   ```
   Sort by Levenshtein distance to input (or just `name` ilike match quality).
   If `gps` is available, sort by distance to user.
3. If any match within **~5km** of user's GPS (or city center if no GPS): show "Did you mean: [Name] [address] [distance]?" with Yes/No buttons
4. "Yes" → emit `onVenueMatched(venue)` → proceed to Step 5 (MenuReview) — no new venue created
5. "No" or no match found: show "Create [typed name]" button at bottom (always visible as fallback)
6. "Create [name]" → emit `onVenueCreated(name: string)` → proceed to Step 5 (MenuReview)

**Props:**
```ts
interface NameEntryProps {
  gps: { lat: number; lng: number } | null
  onVenueMatched: (venue: Venue) => void
  onVenueCreated: (name: string) => void
  onClose: () => void
}
```

**Exit criteria:** Fuzzy query fires on 2+ chars; "Did you mean?" appears for close match; "No" dismisses and shows create button; submission works.

---

## CHUNK 5: Menu Review Screen — HH Time + Text Edit

**Goal:** Replace `MenuConfirm` with a new `MenuReview` that shows HH time detection and parsed menu text for user editing.

**Files to create:**
- `src/components/MenuReview.tsx`

**UI:**

```
┌─────────────────────────────┐
│  ✕                         │
│                             │
│  Review Menu                │
│                             │
│  📷 [thumb1] [thumb2]       │  ← read-only photo strip
│                             │
│  ┌───────────────────────┐  │
│  │ Happy Hour Time        │  │  ← pre-filled by parser
│  │ 4-6pm, daily           │  │  ← editable
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ Parsed Menu Text      │  │
│  │ [large editable area] │  │
│  │                       │  │
│  │ 4-6pm, daily           │  │
│  │ $5 wells, $6 wines    │  │
│  │ $8 cocktails           │  │
│  │ ...                    │  │
│  └───────────────────────┘  │
│                             │
│  [ Commit Menu ]            │
│  or [ Discard ]             │
└─────────────────────────────┘
```

**HH Time Detection — `checkHappyHour()` in `src/lib/happyHourCheck.ts`:**

Currently it returns `{ isHappyHour: boolean, times: string[] }`. Extend it to also return the specific matched time substring for each detection. The review screen shows these in the editable time field. Keep the raw output as-is; don't normalize "4-6pm" to "4:00 PM – 6:00 PM" — preserve what the parser found.

**Parsing happens in the parent (`page.tsx`) before showing this screen.** This screen receives:
```ts
interface MenuReviewProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  venue: Venue | null          // null = new venue being created
  newVenueName?: string         // set if venue is new (from NameEntry)
  parsedText: string           // combined text from all photos
  hhTimes: string[]            // detected time patterns from raw text
  isNotHH: boolean              // true if parser found NO time patterns
  onCommit: (menuText: string, hhTime: string) => Promise<void>
  onDiscard: () => void
  onRetry: () => void           // called if isNotHH=true, returns to camera
  onClose: () => void
}
```

**HH Detection Failure (isNotHH = true):**
- Show error state in MenuReview instead of the normal review UI:
  *"No happy hour times found. Make sure you're uploading a happy hour menu and try again with better lighting."*
- Show [Try Again] button → calls `onRetry()` → return to camera
- Nothing is saved or created at this point

**Exit criteria:** HH time shown pre-filled; text editable; error state when no HH detected; commit/discard/retry all work.

---

## CHUNK 6: Commit Handler — Venue Create + Photo Upload + Photo Sets

**Goal:** Implement the actual commit logic: create/update venue, upload photos, manage photo sets.

**Files to modify:**
- `src/lib/venues.ts`
- `src/app/api/upload-photo/route.ts` (may need extension)
- `src/app/api/create-venue/route.ts` (new endpoint)
- `src/app/api/commit-menu/route.ts` (new endpoint)

**`src/lib/venues.ts` — add functions:**

```ts
// Create a new venue
export async function createVenueForScan(params: {
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  deviceHash: string
}): Promise<Venue>

// Add a photo set to a venue (handles 4-set limit: delete oldest if needed)
export async function addPhotoSet(
  venueId: string,
  photoUrls: string[]
): Promise<void>

// Get the 4 most recent photo sets for a venue
export async function getPhotoSets(venueId: string): Promise<PhotoSet[]>
```

**Upload photos to Supabase Storage:**

Extend existing `/api/upload-photo` or create `/api/upload-photo-set` that:
1. Takes multiple files (FormData with multiple `photo` entries)
2. Uploads each to `venue-photos/{venueId}/{timestamp}/{filename}`
3. Returns array of URLs

**Commit flow (in page.tsx or a dedicated handler):**

```
1. If new venue (name known, no venue object):
   → call createVenueForScan({ name, lat, lng, address, deviceHash })
   → get back venue object with id

2. Upload all photos → get photoUrls[]

3. call addPhotoSet(venueId, photoUrls)
   → internally: INSERT new photo_set row
   → then: DELETE oldest photo_set if count > 4

4. call supabase.venues.update({ menu_text: parsedText, latest_menu_image_url: photoUrls[0] })
   → uses venue.id from step 1 or confirmed venue

5. Refresh map/venue list
```

**API endpoints:**

- `POST /api/create-venue` — creates venue, returns venue object
- `POST /api/upload-photo-set` — accepts FormData with multiple files, returns `photoUrls[]`
- `POST /api/commit-menu` — body: `{ venueId, menuText, hhTime, photoUrls[] }` → does steps 3–4 above

**Exit criteria:** New venue created with GPS; photos uploaded to correct path; oldest photo set purged when >4 exist; `menu_text` updated on venue.

---

## CHUNK 7: Wire Full Flow in page.tsx

**Goal:** Replace the current `scanStep` state machine in `page.tsx` with the new 4-step flow.

**Steps:**
1. `capture` → MenuCapture → 1–4 photos + GPS
2. `venue_picker` → VenuePicker → confirmed venue OR "not listed"
3. `name_entry` → NameEntry → matched venue OR new venue name
4. `review` → MenuReview → commit or discard

**State machine changes in page.tsx:**

Replace `scanStep` values and handlers:

```ts
type ScanStep =
  | 'idle'
  | 'capture'        // MenuCapture
  | 'venue_picker'   // VenuePicker (GPS available)
  | 'name_entry'    // NameEntry (no match or no GPS)
  | 'review'         // MenuReview
  | 'confirm'        // (existing — keep for AddVenueForm legacy path?)

type ScanState = {
  files: File[]
  gps: { lat: number; lng: number } | null
  confirmedVenue: Venue | null       // from venue_picker
  newVenueName: string | null         // from name_entry
  parsedText: string
  hhTimes: string[]
  isNotHH: boolean
}
```

- `handleCapture(files, gps)` → sets files+gps, determines next step:
  - if gps != null → `venue_picker` (call `getVenuesByProximity`)
  - if gps == null → `name_entry` directly
- `handleVenueConfirmed(venue)` → confirmedVenue = venue → call parse + review
- `handleVenueNotListed()` → → `name_entry`
- `handleVenueMatched(venue)` → confirmedVenue = venue → call parse + review
- `handleVenueCreated(name)` → newVenueName = name → call parse + review
- `handleMenuCommit(text, hhTime)` → run commit handler → reset to idle
- `handleMenuDiscard()` / `handleMenuRetry()` → appropriate step back

**Parsing (async, shown during `review` step loading):**

When transitioning to `review`:
1. Parse all photos in parallel via `/api/parse-menu`
2. Combine results → `parsedText`
3. Run `checkHappyHour(parsedText)` → `hhTimes[]`, `isNotHH`
4. Show `MenuReview` with results

**Exit criteria:** Full flow works end-to-end: capture → venue_picker/name_entry → review → commit; all error states handled; map refreshes after commit.

---

## CHUNK 8: Deprecate/Replace AddVenueForm

**Goal:** The new flow makes `AddVenueForm` mostly obsolete. Keep it for the "manually add a venue without a photo" case (accessible from map screen), but strip it down.

**Changes:**
- Remove geocodeAddress call (no longer needed in form)
- Keep only `name` field
- Remove phone/website/type (not needed per spec)
- On submit: create venue with name + GPS (if available from `initialCoords`) + status=unverified
- Redirect to menu scan flow after creation (so user can attach a menu)

**The "Add Venue" button on the map screen** (not the scan flow) should continue to open `AddVenueForm`, but the form now just creates the venue and then prompts to scan a menu.

---

## Notes for Cato

- Work through chunks 1–8 in order. Each chunk has explicit exit criteria.
- If you need clarification on UI details, note the question at the end of your work and push what you have. Don't abandon a chunk because of one open question — ship the code with a TODO comment.
- TypeScript strict mode throughout. Run `npx tsc --noEmit` before marking a chunk done.
- Test on a real device or simulator for GPS behavior — browser DevTools location override is sufficient for development.
- All Supabase calls use the existing `supabase` client from `@/lib/supabase`.
- New API routes go under `src/app/api/`.
