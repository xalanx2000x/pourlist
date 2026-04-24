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
  "deviceHash": "device_xxxxx"                // optional, for rate limiting
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

---

## `POST /api/submit-venue`

**New (2026-04-24).** Single-step new venue creation: dedup check → insert venue → upload photos. Replaces the old two-step `create-venue → commit-menu` flow for new venues.

### Request

`Content-Type: multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `venueName` | string | **Required.** New venue name |
| `exifLat` | number | **Required.** Authoritative venue GPS — from first photo's EXIF |
| `exifLng` | number | **Required.** Authoritative venue GPS — from first photo's EXIF |
| `phoneLat` | number | Phone's current GPS — used only as fraud signal (>500m = gps_mismatch logged) |
| `phoneLng` | number | Phone's current GPS — fraud signal |
| `deviceHash` | string | **Required.** Anonymous device fingerprint |
| `hhSummary` | string | Raw HH schedule text (e.g. "5pm-midnight daily") |
| `hh_type`, `hh_days`, `hh_start`, `hh_end` | string | Window 1 HH data |
| `hh_type_2`, `hh_days_2`, `hh_start_2`, `hh_end_2` | string | Window 2 HH data |
| `hh_type_3`, `hh_days_3`, `hh_start_3`, `hh_end_3` | string | Window 3 HH data |
| `photos` | File[] | 1–4 photo files |

### Behavior

1. **Validation** — `venueName`, `deviceHash`, `exifLat`, `exifLng` required
2. **Dedup check** — queries Supabase for nearby venues (50m radius) with same/similar name using `normName()` (strips "The", lowercase, trims). If match found, returns `duplicate` conflict.
3. **Insert venue** — creates row with `status: 'unverified'`, `contributor_trust: 'new'`, `address_backup: ''` (NOT NULL — backfill via reverse geocoding later). HH fields stored from structured args.
4. **Photo upload** — uploads to Supabase Storage under `venue-photos/{venueId}/{timestamp}/`. If any photo fails, the venue record is **rolled back** (deleted) so no orphan exists. Max 4 photos per submission.
5. **Photo set** — inserts a `photo_sets` row. If >4 sets exist for the venue, oldest set is deleted (both DB record and Storage files).
6. **`latest_menu_image_url`** — set to the first uploaded photo's public URL.
7. **Trust + moderation** — calls `clear_flags_on_menu_commit` RPC (clears all flags on venue) and `increment_device_submissions` RPC (increments device's submission count).
8. **GPS fraud signal** — if `phoneLat`/`phoneLng` are provided and the phone is >500m from the venue, logs a `gps_mismatch` event to `venue_events` (non-blocking — venue creation still succeeds).

### Response

```json
{ "success": true, "venueId": "uuid" }
```

### Error / conflict responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "venueName is required" }` | Missing name |
| 400 | `{ "error": "exifLat and exifLng are required" }` | Missing GPS |
| 400 | `{ "error": "Invalid coordinates" }` | NaN values |
| 200 | `{ "success": false, "reason": "duplicate", "existingVenue": { "id", "name" } }` | Nearby venue with same name found |
| 500 | `{ "success": false, "reason": "photo_upload_failed" }` | Photo upload failed — venue rolled back |

---

## `POST /api/commit-menu`

**Existing venue path.** Updates an existing venue's HH data and uploads photos. Called when `confirmedVenue` is set (user selected from the map or venue picker).

### Request

`Content-Type: multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `venueId` | string | **Required.** Existing venue UUID |
| `photos` | File[] | 1–4 photo files |
| `lat`, `lng` | number | Phone GPS (for proximity check, not stored) |
| `deviceHash` | string | **Required.** Anonymous device fingerprint |
| `hhTime` | string | Legacy HH time string (now superseded by structured hh_* fields) |
| `hhSummary` | string | Raw HH schedule text |
| `hh_type`, `hh_days`, `hh_start`, `hh_end` | string | Window 1 HH data |
| `hh_type_2`, `hh_days_2`, `hh_start_2`, `hh_end_2` | string | Window 2 HH data |
| `hh_type_3`, `hh_days_3`, `hh_start_3`, `hh_end_3` | string | Window 3 HH data |

### Behavior

1. Validates `venueId` exists
2. Uploads photos to Supabase Storage
3. Updates venue: `menu_text` from AI-parsed text, `latest_menu_image_url`, `hh_summary`, and all `hh_type/day/start/end` fields
4. Creates `photo_sets` row (max 4 sets — oldest purged on insert)
5. Calls `clear_flags_on_menu_commit` + `increment_device_submissions` RPCs

### Response

```json
{ "success": true, "venueId": "uuid" }
```

---

## `POST /api/create-venue`

**Legacy — only for old two-step new venue flow.** Creates a minimal venue record with just name + GPS. Used only in the deprecated `create-venue → commit-menu` two-step path, which has been replaced by `submit-venue`.

For new venue creation, use `/api/submit-venue` instead.

---

## `POST /api/flag`

GPS-verified flag submission. Flagger's current GPS must be within **10m** of the venue (Haversine).

### Request

```json
{
  "venueId": "uuid",
  "deviceHash": "device_xxxxx",
  "lat": 45.523,
  "lng": -122.676,
  "reason": "Wrong hours"
}
```

### Behavior

- Haversine check: venue coords vs flagger GPS (10m threshold)
- `flags` row inserted with `active: true`
- `venue_flag_events` row inserted with `action: 'flag'` (idempotent — UNIQUE constraint)
- `device_stats` submission count incremented
- If device has <1 submission, flag is rejected (spam prevention)
- Same device cannot flag the same venue twice in one day (DB constraint)
- If flagging would bring distinct-device flag count to **2** → venue status set to `stale`
- If flagging would bring distinct-device flag count to **4** → venue status set to `closed`

### Response

```json
{ "success": true }
```

---

## `POST /api/confirm`

GPS-verified venue confirmation. Clears all active flags on a venue.

### Request

```json
{
  "venueId": "uuid",
  "deviceHash": "device_xxxxx",
  "lat": 45.523,
  "lng": -122.676
}
```

### Behavior

- Same Haversine 10m check
- Flagger cannot have flagged this venue before
- `venue_flag_events` row with `action: 'confirm'` (idempotent)
- Calls `clear_flags_on_menu_commit` RPC → sets all active flags to `active: false`
- Venue status set to `verified`
- `last_verified` set to now

---

## `POST /api/cron/decay-flags`

Monthly flag decay. Triggered by Vercel cron. Removes the oldest active flag per venue (one per month). Devices cannot reflag after decay.

### Behavior

- For each venue with >0 active flags: removes the oldest flag
- Sets `last_flag_decay_at` to now
- Devices with a `reopen` event on that venue cannot reflag (enforced in DB)

---

## `POST /api/upload-photo`

Uploads a single photo to Supabase Storage.

### Request

`Content-Type: multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `photo` | File | Image file (max 20MB) |
| `venueId` | string | Venue to attach to (optional) |
| `deviceHash` | string | Anonymous fingerprint |
| `lat`, `lng` | number | GPS coordinates (optional) |
| `fingerprint` | string | Client-computed file fingerprint |

### Behavior

1. Validate file size ≤ 20MB
2. Server-side rate limit check
3. Upload to Supabase Storage: `venue-photos/{filename}`
4. Get public URL
5. If `venueId` provided: insert `photos` row (status: `pending`)
6. Call `cycle_old_photos` RPC to enforce 3-photo per-venue retention

### Response

```json
{
  "url": "https://cuzkquenafzebdqbuwfk.supabase.co/storage/v1/object/public/venue-photos/...",
  "fingerprint": "150000-photo.jpg-1234567890",
  "lat": 45.523,
  "lng": -122.676
}
```

---

## `POST /api/rate-limit-check`

Server-side rate limit check. Called by other API routes before processing.

```ts
// Body:
{ "action": "parse-menu" | "submit-menu" | "upload-photo", "deviceHash": "device_xxxxx" }
// Response:
{ "allowed": boolean }
```

Uses server-side check (Supabase). Server-side is **fail-open** — if the check fails, the request proceeds.

---

## `POST /api/track-event`

Analytics event tracking.

```ts
// Body:
{
  "event": "menu_save_success" | "scan_start" | "scan_abandon" | ...,
  "deviceHash": "device_xxxxx",
  "metadata": { ... }  // optional
}
```

---

## API Route Summary

| Route | Method | Status | Purpose |
|-------|--------|--------|---------|
| `/api/parse-menu` | POST | ✅ Built | GPT-4o mini menu OCR |
| `/api/submit-venue` | POST | ✅ Built | Single-step new venue: dedup + create + photo upload |
| `/api/commit-menu` | POST | ✅ Built | Update existing venue HH + upload photos |
| `/api/create-venue` | POST | ⚠️ Legacy | Old two-step path — use submit-venue instead |
| `/api/upload-photo` | POST | ✅ Built | Upload single photo to Supabase Storage |
| `/api/flag` | POST | ✅ Built | GPS-verified flag submission (moderation) |
| `/api/confirm` | POST | ✅ Built | GPS-verified venue confirmation (moderation) |
| `/api/cron/decay-flags` | POST | ✅ Built | Monthly flag decay (cron-triggered) |
| `/api/rate-limit-check` | POST | ✅ Built | Rate limit enforcement |
| `/api/track-event` | POST | ✅ Built | Analytics events |
| `/api/submit-menu` | POST | ✅ Built | Legacy path for simple menu text submission (pre-2026-04-24) |
| `/api/delete-old-photos` | POST | ✅ Built | Photo retention |
| `/api/check-duplicate` | POST | ✅ Built | Duplicate detection |