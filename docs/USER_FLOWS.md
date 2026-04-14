# User Flows

---

## Flow 1: Browse Map / List (Existing, Unchanged)

**Goal:** Find a venue with an active happy hour near you.

### Steps

1. **App opens** to Pearl District by default, centered on your live GPS location (if permission granted) or on a fallback coordinate (45.523, -122.676).
2. **Map loads** with venue pins. Purple pins = currently active happy hour. Amber = has menu but HH not active now.
3. **Search** by venue name or location (address, neighborhood, or zip code). The SearchBar queries Supabase for venue name matches, or falls back to Nominatim for geocoding.
4. **Tap a pin** to open the venue detail sheet:
   - Venue name, address, phone, website
   - Menu photo (if any)
   - Happy hour menu text (scrollable)
   - Status badge (New / HH Active)
   - "Directions" and "on Google" links
5. **Switch to List view** using the tabs to see venues sorted by name.

### How "Active HH" is Determined

`src/lib/activeHH.ts` runs on the stored `menu_text` each time the map loads. It checks:
- Current hour vs. stored time window (e.g., "4–6pm" → active if current hour is between 4 and 18)
- Day-of-week restrictions (e.g., "Mon–Fri 4–7pm" → inactive on weekends unless time matches)
- HH terminology without time (requires both explicit HH language AND a time window, or absence of "closed/ended/done")

---

## Flow 2: Scan and Add Menu to Existing Venue

**Goal:** You walk into a bar, snap a photo of their HH menu, and it gets attached to the venue that's already on the map.

### Steps

1. **Tap "Scan Happy Hour Menu / Add Venue"** button at the bottom.
2. **MenuCapture opens** — tap "Take Photos / Choose from Gallery" to open your camera or photo picker.
   - Select 1–4 photos (supports both single and multi-page menus)
   - GPS is extracted from the first photo's EXIF data, or falls back to browser geolocation
   - You can remove any photo before proceeding
   - Tap "Done"
3. **Nearby venue check** — `getVenuesByProximity(gps, 10m)` is called.
   - **If a venue is found:** `MenuConfirm` shows the matched venue name and address with a green "Adding to [Name]" notice.
   - **If no venue found:** The app falls through to the new venue flow (Flow 3, Step 2 onward).
4. **Parsing** (during the `confirm` step, before the screen appears):
   - All selected photos are converted to base64
   - Each photo is sent to `/api/parse-menu` → GPT-4o mini returns extracted text
   - Text from all photos is concatenated with `"--- Page ---"` separators
   - `checkHappyHour()` runs on the combined text
   - If no HH signals found → `isNotHH = true` (shown as a warning in MenuConfirm)
5. **MenuConfirm screen** shows:
   - Matched venue (if any)
   - Parsed menu text in a scrollable box (editable — tap "Edit")
   - Source photo thumbnails
   - "Save Menu" button (or "Type Menu Manually" if text extraction failed)
6. **Save** triggers:
   - Client-side rate limit check (fail-fast)
   - Photo uploaded to Supabase Storage via `/api/upload-photo`
   - Menu text submitted to `/api/submit-menu` with the matched `venueId`
   - `menu_text` and `menu_text_updated_at` updated on the venue
   - `latest_menu_image_url` set to the uploaded photo
   - Photo retention cleanup: `cycle_old_photos` RPC called to keep only 3 most recent photos
7. **Success banner** appears for 3 seconds: "✓ Saved — [Venue Name] menu updated"
8. **Map refreshes** — venue list is reloaded and the updated venue appears with new data.

### Edge Cases

- **No GPS:** If the photo has no EXIF GPS and browser geolocation is denied, `gps` is `null`. The app proceeds to name-entry/new-venue flow directly.
- **HH detection failure:** Warning shown but user can still submit. The parsed text is preserved and editable.
- **Rate limited:** Red banner appears: "Slow down! Please wait Xs before submitting again."
- **Upload failure:** Non-fatal — the photo upload can fail but the menu text will still be saved. An error is logged but no user-facing error is shown.

---

## Flow 3: Add New Venue + Scan Menu

**Goal:** You find a bar that isn't on the map yet. You photograph their menu, the app creates the venue record, and the menu gets attached.

### Steps

1–4. **Same as Flow 2, Steps 1–4** — photos captured, GPS extracted, nearby venue check returns **0 matches**.
5. **AddVenueForm opens** (current implementation) or **NameEntry** (planned):
   - User types the venue name
   - If GPS was available, `AddVenueForm` reverse-geocodes it to fill the address automatically
   - User can accept or correct the address
   - (Planned `NameEntry` behavior: As user types, fuzzy Supabase search runs after 2+ characters; "Did you mean [Venue]?" shown if a match exists within ~5km)
6. **On submit:** A new venue is created with `status = 'unverified'`, `contributor_trust = 'new'`, and GPS coords (if available).
7. **Control returns to `confirm` step** — `matchedVenue` is set to the newly created venue object.
8. **MenuConfirm** shows the new venue (blue "New venue" notice) and the parsed menu text.
9. **Save** → same as Flow 2, Step 6 (but using the newly created `venueId`).
10. **Success** → venue appears on the map immediately.

### What Happens to GPS

- **If photo had GPS:** Lat/lng stored on the venue record, address optionally reverse-geocoded from GPS.
- **If no GPS available:** Venue created with `lat = null`, `lng = null`. It can still be found via search by name. A future geocoding pass could fill in coordinates.
- **The spec says GPS is the primary location signal** and address is optional display sugar.

---

## Photo Set Behavior (Per Spec — Planned)

The spec describes photo set semantics that are **not yet implemented** in the current codebase:

- Each submission (one scan session) creates one **photo set**
- A photo set = all photos submitted together + a timestamp
- The venue keeps the **last 4 photo sets**
- On the 5th submission, the **oldest set is automatically deleted**
- `menu_text` always reflects the **most recent** committed submission
- Older photo sets are viewable in venue detail (most recent first)

**Current behavior vs. spec:**
- Current: Individual photos stored in `photos` table, 3-photo per-venue retention via `cycle_old_photos` RPC
- Spec: Photo sets stored in `photo_sets` table, 4-set per-venue retention

This discrepancy should be resolved when `photo_sets` migration (chunk 1) and commit-menu endpoint (chunk 6) are implemented.

---

## Multi-Photo Upload Behavior

**Current (per MenuCapture.tsx):**
- User can select multiple files at once (file input `multiple` attribute)
- Or add one at a time via repeated file input clicks (no explicit "add another photo" button in current UI — it's just the native multi-select)
- Max 10MB per individual file, 15MB total batch
- EXIF GPS extracted from the **first** photo only

**Spec behavior:**
- "Add another photo" button visible while < 4 photos
- GPS extracted from first photo if present
- "Done" enabled when ≥1 photo captured

The current `MenuCapture` doesn't have a 4-photo cap or a separate "add another" button — it accepts unlimited multi-select. This is a discrepancy to note.

---

## Error Handling Summary

| Error | Screen | Behavior |
|-------|--------|----------|
| Parse page failure | `MenuConfirm` | Shows inline error, user can retry or type manually |
| No text extracted | `MenuConfirm` | Shows "Type Menu Manually" button |
| No HH detected | `MenuConfirm` | Amber warning banner, submission still allowed |
| Rate limit hit | `MenuConfirm` | Red "Slow down!" banner, submit button disabled |
| Upload fails | `MenuConfirm` | Non-fatal, photo skipped, menu text still saves |
| Geocode fails | `AddVenueForm` | "Couldn't find that address" message, form stays open |
| Venue creation fails | `AddVenueForm` | Error state shown, form stays open |