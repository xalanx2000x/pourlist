# User Flows

---

## Flow 1: Browse Map / List

**Goal:** Find a venue with an active happy hour near you.

### Steps

1. **App opens** — centered on your live GPS location or a fallback (Pearl District, Portland).
2. **Map loads** with venue pins. Purple = happy hour active right now. Amber = has menu but HH not active.
3. **Search** by venue name or location. `SearchBar` queries Supabase for name matches, or Nominatim for geocoding.
4. **Tap a pin** → `VenueDetail` bottom sheet: name, address, phone, website, menu photo, HH schedule, status badge, directions.
5. **Switch to List view** → venues sorted by distance (symmetric with map bounds filter).

### Active HH Detection

`src/lib/activeHH.ts` checks stored HH windows (`hh_type`/`hh_start`/`hh_end`) against current time and day-of-week. No longer relies on `menu_text` parsing.

---

## Flow 2: Scan + Update Existing Venue

**Goal:** You're at a venue that already exists on the map. Snap a photo to update its HH data.

### Steps

1. Tap **"📷 Scan Happy Hour Menu"** button at the bottom.
2. **`MenuCapture`** — tap "📷 Take or Choose Photo" to open camera/gallery. Select 1–4 photos. Tap "Done."
   - `exifGps` = extracted from first photo's EXIF (authoritative venue location)
   - `phoneGps` = current browser location (fraud signal only — not used for venue location)
3. **`VenuePicker`** — shows venues within 50m of `exifGps` or `phoneGps`. Tap "✓ Yes, that's me" to confirm, or "✗ No, I'm not here" to skip to name entry.
   - If 0 nearby venues → auto-advances to `name_entry`
4. **`MenuReview`** — shows parsed HH schedule (from AI menu text) with editable HH window boxes. Tap "💾 Save Happy Hour" to commit.
5. **API call** → `POST /api/commit-menu` with `venueId` + photos + HH data.
6. **Success banner** for 3 seconds. Map refreshes with updated venue data.

### Key behavior

- **EXIF GPS = authoritative venue location.** No address entry required for new venues.
- **Phone GPS = fraud check only.** Compared against venue coordinates to log `gps_mismatch` events if >500m apart.
- **No duplicate venues created** — `VenuePicker` confirms against existing DB venues before creating.

---

## Flow 3: Add New Venue + Scan Menu

**Goal:** You find a bar that isn't on the map. Photograph the menu → app creates the venue record with EXIF GPS, attaches menu photos.

### Steps

1. Same as Flow 2, Step 2 — capture photos, extract `exifGps` + `phoneGps`.
2. **`VenuePicker`** — no nearby matches found → tap "✗ No, I'm not here" (or auto-advances if 0 results).
3. **`NameEntry`** — type the venue name. Fuzzy search runs after 2+ characters. "Did you mean [Venue]?" shown if a match exists within 5km.
   - Tap a suggestion → routes to Flow 2 (existing venue path)
   - No match → submit as new venue
4. **`MenuReview`** — same as Flow 2, Step 4.
5. **API call** → `POST /api/submit-venue` (single step):
   - Name dedup: checks 50m radius for venue with same/similar name → `duplicate` conflict if found
   - Venue created with EXIF GPS as authoritative coordinates
   - Photos uploaded; if any fail, venue is rolled back (deleted)
   - Success → venue appears on map immediately

### Error handling

| Scenario | Behavior |
|----------|----------|
| Name dedup match found | Error: "Venue already exists nearby as [name]. Want to update that instead?" |
| Photo upload fails | Venue deleted (rollback), error shown, user retries |
| No EXIF GPS available | Error: "No location found. Please take the photo at the venue." |
| Rate limited | "Slow down! Please wait Xs" error before submission |

---

## Flow 4: Pre-Selected Venue (from map/list)

**Goal:** User long-pressed/selected a venue on the map before scanning.

### Steps

1. User taps venue pin → `VenueDetail` opens.
2. Taps "📷 Scan Happy Hour Menu" — `confirmedVenue` is pre-set.
3. `MenuCapture` → `handleCapture` detects `confirmedVenue` is set → skips `VenuePicker`, goes directly to `MenuReview`.
4. `MenuReview` → same as Flow 2, Step 4.
5. API: `commit-menu` with pre-set `venueId`.

---

## Scan Step State Machine

```
idle
  │
  └── 'capture'     → MenuCapture (take 1–4 photos, extract exifGps + phoneGps)
                           │
                           ▼
                    'venue_picker' → VenuePicker (confirm against nearby venues)
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

| Step | Component | Trigger |
|------|-----------|---------|
| `idle` | Map/list | Default |
| `capture` | `MenuCapture` | Scan button tapped |
| `venue_picker` | `VenuePicker` | GPS available, 0+ nearby venues |
| `name_entry` | `NameEntry` | "I'm not here" or no GPS |
| `review` | `MenuReview` | Parsed menu ready, user ready to commit |

---

## Photo Behavior

- **GPS source:** EXIF GPS from first photo only — used as venue coordinates
- **Phone GPS:** Browser geolocation — fraud signal only (logs `gps_mismatch` if >500m from venue)
- **Max photos per submission:** 4
- **Retention:** Last 4 photo sets per venue. On 5th set, oldest is deleted (DB record + Storage files)
- **Photo rollback:** If any photo in a `submit-venue` call fails to upload, the entire venue record is deleted (no orphan venues)

---

## GPS Signal Separation

| Signal | Source | Stored on venue? | Purpose |
|--------|--------|-----------------|---------|
| `exifGps` | First photo's EXIF | **Yes** — `lat`/`lng` | Authoritative venue location |
| `phoneGps` | Browser geolocation | **No** | Fraud signal: logged to `venue_events` if >500m from venue |

This separation prevents the common bug where a user's phone GPS (which may be inaccurate indoors) overrides the photo's EXIF GPS (which was captured at the venue).

---

## Error Handling Summary

| Error | Screen | Behavior |
|-------|--------|----------|
| Parse page failure | `MenuReview` | Inline error, retry or type manually |
| No EXIF GPS | `MenuReview` | "No location found. Please take the photo at the venue." |
| Dedup conflict | `MenuReview` | Error with existing venue name + option to update that venue |
| Photo upload fails | `submit-venue` | Venue rolled back, error shown, user retries |
| Rate limit hit | `MenuReview` | Red banner, submit button disabled |
| No HH detected | `MenuReview` | Warning shown but submission allowed |
| Geocode fails | `NameEntry` | "Couldn't find that address" — form stays open |