# API Routes

All routes live under `src/app/api/`. All responses are JSON. Errors include `{ error: string }`.

---

## `POST /api/parse-menu`

Parses a happy hour menu photo using GPT-4o mini with vision.

### Request

```json
{
  "imageData": "data:image/jpeg;base64,...",  // base64 data URL (preferred)
  "imageUrl": "https://...",                   // public URL (fallback)
  "deviceHash": "device_xxxxx"               // optional, for rate limiting
}
```

Either `imageData` or `imageUrl` is required — not both (prefer `imageData`).

### How it works

1. Builds an OpenAI messages array with a system prompt: *"You are a menu extraction assistant..."*
2. Sends the image as a `image_url` content part (base64 inline or fetched URL)
3. GPT-4o mini returns all extracted text verbatim
4. Result is returned as plain text

### Response

```json
{ "text": "4-6pm, daily\n$5 wells\n$6 wines\n$8 cocktails..." }
```

### Error responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "imageUrl or imageData is required" }` | Neither field provided |
| 400 | `{ "error": "Failed to fetch image: 404" }` | `imageUrl` fetch failed |
| 429 | `{ "error": "Rate limit exceeded..." }` | Device hash blocked by server-side rate limiter |
| 504 | `{ "error": "Request timed out..." }` | GPT-4o mini didn't respond in 30s |
| 500 | `{ "error": "..." }` | Other errors |

### Model used

**GPT-4o mini** — `max_tokens: 2048`, `signal: AbortController` with 30s timeout.

### Notes

- Photos are parsed **one at a time** in a loop (current code). The spec calls for **parallel** parsing of all photos in a session, but `page.tsx` currently calls parse sequentially with a `for` loop.
- The prompt preserves prices, times, drink names. Illegible text is marked as `[illegible]`.
- No correction or interpretation is applied — raw extraction only.
- Server-side rate limit check calls `/api/rate-limit-check` with `action: 'parse-menu'`.

---

## `POST /api/submit-menu`

Creates a new venue or updates an existing one with menu text. Also handles geo-check verification.

### Request

```json
{
  "menuText": "4-6pm\n$5 wells...",
  "venueId": "uuid",           // if updating existing venue
  "venueName": "Jolly Rodger", // required if no venueId
  "address": "5627 S Kelly Ave, Portland, OR",
  "lat": 45.523,
  "lng": -122.676,
  "deviceHash": "device_xxxxx",
  "imageUrl": "https://..."   // optional, URL of uploaded photo
}
```

### Behavior

**If `venueId` is provided (updating existing venue):**
1. HTML-escape `menuText` (XSS prevention — venue data is publicly readable)
2. Check `menuText` length ≤ 10,000 chars
3. Update `venues` row: set `menu_text`, `menu_text_updated_at`
4. If `photoLat`/`photoLng` provided: verify photo location is within **10m** of venue coords (Haversine). If too far, return 400 error.
5. If geo-check passes: update most recent pending photo from this device to `location_verified = true`

**If `venueId` is NOT provided (creating new venue):**
1. Validate `venueName` and `address` are present
2. Reverse-geocode lat/lng to get an address string if `lat`/`lng` provided but no `address`
3. Insert new row into `venues` with `status: 'unverified'`, `contributor_trust: 'new'` or `'anonymous'`
4. Set `menu_text` and `menu_text_updated_at`

### Response

```json
{ "venueId": "uuid", "success": true }
```

### Error responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "menuText is required" }` | Missing menu text |
| 400 | `{ "error": "...exceeds 10,000 characters" }` | Text too long |
| 400 | `{ "error": "venueName and address are required..." }` | Creating venue without required fields |
| 400 | `{ "error": "Unable to verify location..." }` | Photo GPS >10m from venue |
| 429 | `{ "error": "Rate limit exceeded..." }` | Device hash blocked |
| 500 | `{ "error": "Failed to create venue" }` | Supabase insert failed |
| 500 | `{ "error": "Failed to update menu" }` | Supabase update failed |

### XSS Sanitization

All `menuText` is HTML-escaped before storing:
```ts
text.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&#39;')
```

### Geo-check

A 10-meter Haversine threshold is applied when a photo GPS is provided for an existing venue. If the photo was taken elsewhere, the submission is rejected. This prevents mismatched venue assignments.

---

## `POST /api/upload-photo`

Uploads a single photo to Supabase Storage and creates a `photos` DB record.

### Request

`Content-Type: multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `photo` | File | The image file (max 20MB) |
| `venueId` | string | Venue to attach to (optional) |
| `deviceHash` | string | Anonymous fingerprint |
| `lat` | string | GPS latitude (optional) |
| `lng` | string | GPS longitude (optional) |
| `fingerprint` | string | Client-computed file fingerprint |

### Behavior

1. Validate file size ≤ 20MB
2. Server-side rate limit check (`action: 'upload-photo'`)
3. Convert `File` to `Buffer` via `arrayBuffer()`
4. Upload to Supabase Storage: `venue-photos/{filename}` with original MIME type
5. Get public URL from Supabase
6. If `venueId` provided: insert a row into `photos` table (status: `pending`)
7. Call `cycle_old_photos` RPC to enforce 3-photo per-venue retention:
   - Delete oldest DB records beyond 3 most recent
   - Collect their storage paths and delete the actual files from Supabase Storage

### Response

```json
{
  "url": "https://cuzkquenafzebdqbuwfk.supabase.co/storage/v1/object/public/venue-photos/...",
  "fingerprint": "150000-photo.jpg-1234567890",
  "lat": 45.523,
  "lng": -122.676
}
```

### Error responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "No photo provided" }` | Missing file |
| 400 | `{ "error": "File too large. Maximum size is 20MB." }` | Over limit |
| 429 | `{ "error": "Rate limit exceeded..." }` | Device hash blocked |
| 500 | `{ "error": "..." }` | Upload or DB insert failed |

### Photo Retention

Retention is per-venue, keeping the **3 most recent** photos. The `cycle_old_photos` RPC is called **after every successful upload** for venues with a `venueId`. Old photo DB records and their corresponding Storage files are both deleted.

**Note:** The spec calls for **4 photo sets** retention (grouped by submission session), not individual photos. This is not yet implemented — the current system operates on individual photos with 3-photo retention.

---

## `POST /api/create-venue` — **Planned, Not Yet Built**

Per the spec: creates a new venue record without any menu text.

### Expected behavior

```ts
// Body (expected):
{
  "name": "Jolly Rodger",
  "lat": 45.523,       // or null
  "lng": -122.676,     // or null
  "address": "5627 S Kelly Ave", // optional
  "deviceHash": "device_xxxxx"
}

// Response:
{ "venue": { ...Venue object } }
```

**Status:** This route does not exist yet. Currently `AddVenueForm` calls `addVenue()` from `src/lib/venues.ts` directly. The spec calls for a dedicated `/api/create-venue` route to be used in the new upload flow.

---

## `POST /api/commit-menu` — **Planned, Not Yet Built**

Per the spec: the full commit flow — creates or confirms a venue, uploads photo set, saves menu text, manages photo sets.

### Expected behavior

```ts
// Body (expected):
{
  "venueId": "uuid",              // null if new venue
  "newVenueName": "Jolly Rodger", // set if venueId is null
  "gps": { "lat": 45.523, "lng": -122.676 },
  "menuText": "4-6pm\n$5 wells...",
  "hhTime": "4-6pm, daily",
  "photoUrls": ["https://...", "https://..."]  // URLs after upload
}

// Actions:
// 1. If venueId is null → create new venue via /api/create-venue
// 2. Upload photos via /api/upload-photo-set
// 3. INSERT new photo_set row
// 4. DELETE oldest photo_set if count > 4
// 5. Update venue: menu_text, latest_menu_image_url, menu_text_updated_at
// 6. Refresh map

// Response:
{ "success": true, "venueId": "uuid" }
```

**Status:** This route does not exist yet. The commit flow currently happens inline in `page.tsx` via `handleMenuConfirm()` which calls `/api/upload-photo` (single photo) and `/api/submit-menu` separately.

---

## Other API Routes

### `POST /api/check-duplicate`

Not reviewed in detail — likely compares photo hash or menu text similarity against existing data for a venue. Used during the scan flow.

---

### `POST /api/delete-old-photos`

Not reviewed in detail — likely a manual trigger for photo retention cleanup.

---

### `POST /api/rate-limit-check`

Server-side rate limit check. Called by other API routes before processing.

```ts
// Body:
{ "action": "parse-menu" | "submit-menu" | "upload-photo", "deviceHash": "device_xxxxx" }
// Response:
{ "allowed": boolean }
```

Uses a combination of client-side localStorage (`rateLimit.ts`) and server-side check (likely stored in Supabase or in-memory). Server-side is fail-open — if the check fails, the request proceeds.

---

### `POST /api/track-event`

Analytics event tracking.

```ts
// Body:
{
  "event": "menu_parse_success" | "menu_save_success" | "onboarding_complete" | ...,
  "deviceHash": "device_xxxxx",
  "metadata": { ... }  // optional
}
```

---

## API Route Summary

| Route | Method | Status | Purpose |
|-------|--------|--------|---------|
| `/api/parse-menu` | POST | ✅ Built | GPT-4o mini menu OCR |
| `/api/submit-menu` | POST | ✅ Built | Create/update venue + save menu text |
| `/api/upload-photo` | POST | ✅ Built | Upload photo to Supabase Storage |
| `/api/create-venue` | POST | 🔨 Planned | Create new venue (replaces direct `addVenue()` call) |
| `/api/commit-menu` | POST | 🔨 Planned | Full commit flow: venue + photos + menu |
| `/api/check-duplicate` | POST | ✅ Built | Duplicate detection |
| `/api/delete-old-photos` | POST | ✅ Built | Photo retention |
| `/api/rate-limit-check` | POST | ✅ Built | Rate limit enforcement |
| `/api/track-event` | POST | ✅ Built | Analytics |