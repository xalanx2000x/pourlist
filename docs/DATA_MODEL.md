# Data Model

## Tables Overview

| Table | Purpose |
|-------|---------|
| `venues` | Every bar or restaurant with a happy hour program |
| `photo_sets` | Photo groupings per scan session (max 4 per venue) |
| `venue_events` | Analytics events: gps_mismatch, photo_upload, hh_confirm, etc. |
| `device_stats` | Per-device submission count (for trusted contributor logic) |
| `flags` | GPS-verified moderation flags on venues |
| `venue_flag_events` | Immutable log of flag/confirm/reopen actions (idempotency) |

---

## `venues` Table

Primary table. GPS source is **EXIF from photo** — no address entry required.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | text | Venue name — required |
| `address_backup` | text | Legacy address field — preserved, phased out. Empty string for new venues. Reverse-geocoded later. |
| `lat` | numeric | Latitude from photo EXIF (authoritative) |
| `lng` | numeric | Longitude from photo EXIF (authoritative) |
| `zip` | text | ZIP — currently hardcoded to `97209` (Pearl District) |
| `phone` | text | Optional |
| `website` | text | Optional |
| `type` | text | e.g. "bar", "restaurant" — optional |
| `status` | text | `unverified` \| `verified` \| `stale` \| `closed` |
| `contributor_trust` | text | `new` \| `trusted` |
| `last_verified` | timestamptz | Last GPS-verified confirm |
| `last_flag_decay_at` | timestamptz | Last flag decay cron run |
| `photo_count` | integer | Approximate count (not tightly synced) |
| `created_at` | timestamptz | |
| `menu_text` | text | Legacy HTML-escaped text — superseded by hh_* fields |
| `menu_text_updated_at` | timestamptz | Legacy |
| `latest_menu_image_url` | text | Public URL of most recent photo |
| `hh_summary` | text | Raw text: "5pm-midnight daily" |
| `hh_type` | text | Window 1: `typical` \| `all_day` \| `open_through` \| `late_night` |
| `hh_days` | text | Window 1: comma-separated day numbers (1=Mon, 7=Sun) |
| `hh_start` | integer | Window 1: minutes from midnight (e.g. 1020 = 5pm) |
| `hh_end` | integer | Window 1: minutes from midnight, null = "close" |
| `hh_type_2` | text | Window 2 (same enum) |
| `hh_days_2` | text | Window 2 day list |
| `hh_start_2` | integer | Window 2 start |
| `hh_end_2` | integer | Window 2 end |
| `hh_type_3` | text | Window 3 |
| `hh_days_3` | text | Window 3 day list |
| `hh_start_3` | integer | Window 3 start |
| `hh_end_3` | integer | Window 3 end |

### Status Lifecycle

```
unverified → verified → stale → closed
```

- **N=2 distinct devices flag** → `stale` (hidden from main map, still visible in search)
- **N=4 distinct devices flag** → `closed` (fully hidden)
- **`confirm` (GPS-verified)** → `verified` + all flags cleared

### Trust

- **New:** 0–9 lifetime submissions
- **Trusted:** 10+ lifetime submissions (incremented by `increment_device_submissions` RPC on every successful submission)

---

## `photo_sets` Table

Replaces individual `photos` table. Groups all photos from one scan session.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK) | Which venue |
| `photo_urls` | text[] | Array of Supabase Storage public URLs |
| `uploader_device_hash` | text | Anonymous fingerprint |
| `created_at` | timestamptz | |

### Retention Policy

**Max 4 photo sets per venue.** On the 5th insert, the oldest set is deleted (both DB row and Storage files). Enforced in `submit-venue` and `commit-menu` API routes.

---

## `venue_events` Table

Analytics event log. Non-critical — failures do not rollback the parent operation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK, nullable) | Associated venue |
| `event_type` | text | `gps_mismatch` \| `photo_upload` \| `hh_confirm` \| `scan_start` \| `scan_abandon` \| ... |
| `device_hash` | text | Anonymous fingerprint |
| `lat` | numeric | GPS coordinate where event fired |
| `lng` | numeric | |
| `created_at` | timestamptz | |

### `gps_mismatch` Events

Logged when `phoneGps` is **>500m** from `exifGps` (venue location). Indicates possible address spoofing. Used for fraud analysis — does not affect venue status.

---

## `device_stats` Table

Tracks per-device submission count for trust scoring.

| Column | Type | Description |
|--------|------|-------------|
| `device_hash` | text | Primary key |
| `submission_count` | integer | Lifetime successful submissions |
| `updated_at` | timestamptz | |

Incremented via `increment_device_submissions` RPC on every successful menu save.

---

## `flags` Table

GPS-verified moderation flags. Haversine 10m check enforced in the API route.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK) | Venue being flagged |
| `device_hash` | text | Anonymous fingerprint |
| `active` | boolean | `true` = active flag, `false` = cleared by confirm/decay |
| `lat` | numeric | Flagger's GPS at time of flag |
| `lng` | numeric | |
| `created_at` | timestamptz | |

**Constraints:**
- Same device cannot flag the same venue more than once per day
- Device must have ≥1 lifetime submission before flagging
- Flagger cannot confirm their own flag (enforced in `confirm` API route)

---

## `venue_flag_events` Table

Immutable log. Enforces idempotency via `UNIQUE(venue_id, device_hash, action)`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `venue_id` | UUID (FK) | |
| `device_hash` | text | |
| `action` | text | `flag` \| `confirm` \| `reopen` |
| `created_at` | timestamptz | |

---

## Dedup Logic

### GPS-based dedup (exact match check)

When a new venue is submitted via `submit-venue`:
1. Query venues within **50m** (Haversine) of `exifGps`
2. If name normalized (`normName()` — strips "The", lowercases, trims) matches any nearby venue → return `duplicate` conflict
3. User sees: `"Venue already exists nearby as [name]. Want to update that instead?"`

### Name fuzzy match (NameEntry)

`NameEntry` queries Supabase `ILIKE %name%` with a 5km radius after 2+ characters typed. Shows "Did you mean [Venue]?" suggestions.

---

## Address Handling

**No address entry for new venues.** EXIF GPS from the photo is the authoritative location signal. `address_backup` is stored as an empty string initially and backfilled via reverse geocoding in a future pass.

The `address` column was renamed to `address_backup` in 2026-04-17 to reflect its deprecated status. It is preserved for backward compatibility with existing data but is not written by new submissions.

---

## XSS Sanitization

All `menu_text` is HTML-escaped before storing:
```ts
text.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&#39;')
```

`hh_summary` is stored as raw text (user input) and displayed as-is without HTML rendering.