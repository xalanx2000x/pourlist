# Data Model

## Tables Overview

| Table | Purpose |
|-------|---------|
| `venues` | Every bar or restaurant with a happy hour program |
| `photos` | Individual photo submissions (reference images) |
| `flags` | User-submitted moderation flags on venues or photos |
| `photo_sets` | **Planned** — groups photos submitted together in one session |

---

## `venues` Table

The primary table. Every bar/restaurant in the app is a row here.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, auto-generated |
| `name` | text | Venue name — required |
| `address` | text | Street address (may be partial if GPS-only) |
| `lat` | numeric | Latitude (null if geocoding failed or GPS not available) |
| `lng` | numeric | Longitude |
| `zip` | text | ZIP code — currently hardcoded to `97209` (Pearl District) |
| `phone` | text | Phone number (optional, not captured in new upload flow) |
| `website` | text | Website URL (optional, not captured in new upload flow) |
| `type` | text | Venue type e.g. "bar", "restaurant" (optional, not captured in new upload flow) |
| `status` | text | `unverified` \| `verified` \| `stale` \| `closed` — see Status Lifecycle below |
| `contributor_trust` | text | `new` \| `trusted` \| `anonymous` — trust level of the last contributor |
| `last_verified` | timestamptz | When the venue was last confirmed/updated |
| `photo_count` | integer | Count of photos on file (not currently kept in sync) |
| `created_at` | timestamptz | When the venue row was created |
| `menu_text` | text | The most recent happy hour menu text (HTML-escaped on write) |
| `menu_text_updated_at` | timestamptz | When `menu_text` was last changed |
| `latest_menu_image_url` | text | Public URL of the most recent menu photo |
| `address_normalized` | text | **Planned** — canonical single-line address (not yet implemented) |

---

## `photos` Table

Individual photo records. Photos are uploaded to Supabase Storage; this table holds metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK) | Which venue this photo belongs to |
| `url` | text | Public Supabase Storage URL |
| `uploader_device_hash` | text | Anonymous device fingerprint of uploader |
| `lat` | numeric | **Not currently stored** — used only for geo-check during submission, then discarded |
| `lng` | numeric | **Not currently stored** — same as above |
| `status` | text | `pending` \| `approved` \| `rejected` — moderation status |
| `flagged_count` | integer | Number of times this photo has been flagged |
| `moderation_confidence` | numeric | **Planned** — AI confidence score for auto-moderation |
| `created_at` | timestamptz | Upload timestamp |

### Photo Retention Policy

**Current behavior:** Each venue retains the **3 most recent** photos. The `cycle_old_photos` Supabase RPC is called after every upload to enforce this — oldest photos beyond the limit are deleted from both the DB and Supabase Storage.

**Planned behavior (per spec):** Each venue should retain the **last 4 photo sets** (each set = photos from one scan session). The `photo_sets` table would track groupings, and retention would be based on photo sets rather than individual photos. **This is not yet implemented.**

---

## `flags` Table

User-submitted moderation reports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK, nullable) | Venue being flagged (null if flagging a photo instead) |
| `photo_id` | UUID (FK, nullable) | Photo being flagged (null if flagging a venue instead) |
| `reason` | text | Free-text reason for the flag |
| `device_hash` | text | Anonymous fingerprint of flagger |
| `created_at` | timestamptz | When flag was submitted |

---

## `photo_sets` Table — **Planned, Not Yet Implemented**

Per the spec, this table groups photos submitted together in one session:

```sql
CREATE TABLE photo_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  photo_urls TEXT[]  -- array of Supabase Storage URLs
);
-- Index on (venue_id, created_at DESC)
```

**Current status:** This table does not exist in the codebase. Photo groupings are currently implicit (multiple files uploaded separately but associated with the same venue in sequence). The `photo_sets` migration is chunk 1 in the implementation plan but has not been applied yet.

---

## Venue Deduplication Logic

When a user scans a menu with GPS coordinates, the app checks for existing venues within **10 meters**.

**How proximity is calculated:** Haversine formula (great-circle distance) — more accurate than a rectangular bounding box for small radii.

```ts
// src/lib/venues.ts — getVenuesByProximity()
const R = 6371000  // Earth radius in meters
// ... Haversine filter applied post-query ...
return R * c <= radiusMeters  // radiusMeters = 10 for dedup
```

**If 0 nearby venues:** User proceeds to name-entry step. A new venue is created with GPS coordinates from the photo (or null if unavailable).

**If 1+ nearby venues:** Shown in the `VenuePicker` screen (planned) for user confirmation. The code currently shows a single match in `MenuConfirm` without a picker UI.

**Name-based dedup:** When the user types a venue name, `NameEntry` (planned) queries Supabase with `ILIKE '%name%'` and shows "Did you mean [Venue]?" if a match is found within ~5km.

---

## Status Lifecycle

```
unverified → verified → stale → closed
```

| Status | Meaning |
|--------|---------|
| `unverified` | New venue added by a community member. No manual confirmation yet. |
| `verified` | The venue has been manually confirmed to exist and have a HH program. |
| `stale` | The venue had a menu at some point but hasn't been updated in a long time. Still visible. |
| `closed` | The venue is no longer operating. Hidden from normal results. |

### Status Transitions

- **Any status** can have its `menu_text` updated by any user
- `unverified` → `verified`: Manual admin action (moderation page — `src/app/admin/page.tsx`)
- `verified` → `stale`: Happens automatically when `menu_text_updated_at` is old (exact threshold not currently enforced in code — admin page shows stale venues for review)
- Any → `closed`: Admin action (currently no UI for this; would require DB update)

---

## Address Normalization — **Planned**

The spec calls for a `normalizeAddress()` utility in `src/lib/addresses.ts` that converts full addresses to a canonical format. For example:

- `"5627 S Kelly Avenue, Portland, OR 97239"` → `"5627 S Kelly Ave"`

This would:
- Drop city/state/ZIP
- Abbreviate: Ave→Ave, St→St, Blvd→Blvd, Dr→Dr, Ln→Ln
- Preserve directionals: NW/NE/SE/SW, N/S/E/W
- Preserve ordinals: 1st, 2nd, etc.

**Current status:** `src/lib/addresses.ts` does not exist. The `address_normalized` column is not populated.