# Pour List — Upload Flow Spec

## Overview

Redesigned upload flow centered on a clean user experience:
photo → venue confirmation → menu review → commit.

---

## Step 0: Scan Button

Button: **"Scan Happy Hour Menu / Add Venue"**

Opens `MenuCapture` — a camera interface that accepts 1–4 photos per session.

- Photos captured via device camera
- User can add more photos (up to 4 total)
- "Done" to proceed
- GPS extracted from photo EXIF data if available; otherwise prompt for browser location
- If no GPS and browser location denied → scan still proceeds with `gps: null`

---

## Step 1: Venue Confirmation

**Venue picker screen** shown immediately after photos captured.

### If GPS available:

App queries venues within **10 meters** of photo GPS.

**0 nearby venues found:**
- Proceed to Step 2A (new venue, name only)

**1+ nearby venues found:**
- Show: "Are you at **[Venue Name]**?" with options:
  - **"Yes"** → proceed to Step 3 (attach to confirmed venue)
  - **"No"** → if multiple: "No, I'm at one of these / No, I'm at none of these"
    - "No, I'm at one of these" → user picks from list
    - "No, I'm at none of these" → Step 2A (new venue)
  - Venue names shown with address snippet for disambiguation

### If no GPS available:

Proceed directly to Step 2A (new venue, name only).

---

## Step 2: New Venue Creation

### Step 2A: Name Entry

- Free-form text input: "What's the venue called?"
- As user types: query Supabase for venues with similar names in the Portland area (fuzzy match on name)
- If match found within 5km: show inline prompt below field: *"Did you mean **[Matched Venue Name]**?"*
  - **"Yes"** → use matched venue → proceed to Step 3 (attach to existing venue)
  - **"No / Keep typing"** → user continues typing, create as new venue
- On submit with no match: create new venue with entered name + GPS (if available)

### Step 2B: Confirm Venue (post-name-entry)

Shown after name entered (if GPS was available and address can be reverse-geocoded):
- Pre-filled address (from reverse geocoding photo GPS) shown for confirmation
- User can:
  - **"Looks good"** → proceed to Step 3
  - **"Wrong address / Edit"** → inline text field opens with pre-filled address, user corrects → on submit, proceed to Step 3
- If reverse geocode fails: address field left blank, user can optionally fill it in; venue creation proceeds regardless

### Venue creation specs:
- GPS is the primary location signal; address is optional display sugar
- Status: `unverified`
- `contributor_trust`: `new`
- If no GPS and no address: venue created with lat/lng = null — it's a pinless venue that can be found via search and geocoded later

---

## Step 3: Menu Parsing

Photo(s) submitted → GPT-4o mini parses all photos in parallel → combined text.

### Parsing behavior:
- All photos in the submission parsed in parallel (faster)
- Combined into one text block for review
- **HH time detection**: scan raw text for patterns matching time ranges (e.g., "4–6pm", "3-7pm", "5–8pm Mon–Fri")
  - If detected: show detected time(s) in a dedicated editable field above the menu text box
  - If NOT detected: show error state: *"No happy hour times found. Please make sure you're uploading a happy hour menu and try again with better lighting."* → return to Step 0; nothing is saved
- User sees: editable HH time field + editable menu text box
- Both fields are user-editable; parser pre-fills what it found but user can adjust
- User can cancel → discard everything, return to map

### On commit:
1. Venue created in `unverified` status (Step 2 or existing confirmed venue)
2. Photo(s) uploaded to Supabase Storage under `venue-photos/{venue_id}/{timestamp}/`
3. `menu_text` saved/updated on venue record
4. `latest_menu_image_url` set to most recent photo
5. If 4+ photo sets exist for this venue: oldest set deleted (by `created_at`)
6. User returned to map with success confirmation

---

## Multiple Submissions Per Venue

- `menu_text` always reflects **most recent** committed submission
- Venue retains **last 4 photo sets** (each set = photos submitted together + timestamp)
- Each photo set viewable in venue detail view (most recent first)
- Older sets auto-purged on 5th submission

---

## Data Model Notes

### Venue
- `id`, `name`, `address` (optional), `lat` (optional), `lng` (optional)
- `menu_text` — most recent parsed text
- `latest_menu_image_url` — most recent photo URL
- `status`: `unverified | verified | stale | closed`
- `photo_sets`: array of `{ created_at, photo_urls[] }` — last 4

### Photos (per set)
- Multiple photos per submission
- Uploaded to Supabase Storage
- Reference stored in venue `photo_sets`

### Spam Prevention
- Device hash rate limiting (existing, unchanged)
- GPS + name deduplication within 10m radius (new)
- Max 4 photos per submission

---

## UX States Summary

| Step | Screen | Outcome |
|------|--------|---------|
| 0 | Camera capture (1–4 photos) | Photos + GPS collected |
| 1 | "Are you at X?" | Venue ID confirmed or null |
| 2A | Name entry + fuzzy match | New venue name |
| 2B | Address confirmation (optional) | Address resolved |
| 3 | Menu text + HH time review | Everything committed or discarded |

---

## Rejected / Out of Scope

- No USPS address validation (use Nominatim + basic parser)
- No geocoding required at submission time
- No phone/website/type fields in submission form
- No GPS-only venue blocking — GPS optional but preferred
- No pre-submission HH detection blocking (only post-parse blocking)
