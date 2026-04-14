# Component Inventory

---

## `Map.tsx`

**What it does:** Renders a Mapbox GL JS map with venue pins. Handles clustering for dense areas, pin colors by status/HH state, and user location fly-to.

**Props:**
```ts
interface MapProps {
  venues: Venue[]                        // All venues to show
  selectedVenue: Venue | null            // Currently selected venue (for fly-to)
  onVenueSelect: (venue: Venue) => void  // Called when user taps a pin
  center?: [number, number]               // [lng, lat] — defaults to Pearl District
  flyToUserLocation?: { lat: number; lng: number } | null  // Fly here on first load
}
```

**Pin color logic:**
- Purple (`#7c3aed`) = active happy hour right now (via `hasActiveHappyHour()`)
- Amber (`#f59e0b`) = unverified with no active HH
- Orange (`#f97316`) = stale
- White stroke = selected

**Key behaviors:**
- Clusters venues when zoomed out (cluster circles in amber)
- Clicking a cluster zooms in; clicking a pin selects the venue and flies to it
- `flyToUserLocation` triggers a one-time map fly-to on mount

**File:** `src/components/Map.tsx`

---

## `SearchBar.tsx`

**What it does:** Search input that queries venues by name (Supabase) or location (Nominatim geocoding).

**Props:**
```ts
interface SearchBarProps {
  onSearch: (coords: { lat: number; lng: number }) => void    // Location search result
  onVenueSelect: (venue: Venue) => void  // Venue name result — opens venue detail
  onClear: () => void                    // Reset to default location
}
```

**How it works:**
1. User types a query and submits (Enter or search button)
2. If query is a 5-digit zip → skip venue search, geocode with Nominatim directly
3. Search Supabase for `name ILIKE '%query%'` (case-insensitive)
4. If venues found → show dropdown of venue names; tapping one calls `onVenueSelect`
5. If no venue match → geocode with Nominatim; on success calls `onSearch` with coordinates
6. If Nominatim also fails → show "Location not found" error for 3 seconds

**Note:** There's a discrepancy in the current code — `onVenueSelect` calls `handleVenueSelect` which **also** calls `getVenuesByProximity` to add the venue to the map, but only if it's not already in the list. The venue list is also separately loaded via `loadVenues()`. In practice, selecting a venue from the dropdown updates `userLocation` (map re-centers) and adds the venue to the list, but the behavior depends on whether the venue was already loaded.

**File:** `src/components/SearchBar.tsx`

---

## `VenueList.tsx`

**What it does:** Scrollable list of `VenueCard` components with a header showing count and HH count.

**Props:**
```ts
interface VenueListProps {
  venues: Venue[]
  selectedVenue: Venue | null
  onVenueSelect: (venue: Venue) => void
}
```

**Behavior:**
- Shows count header: "X venues in Pearl District (97209)" + "(Y with active HH)" in purple if any
- Empty state: "No venues found in this area. Be the first to add one!"
- Each item rendered as `VenueCard`

**File:** `src/components/VenueList.tsx`

---

## `VenueDetail.tsx`

**What it does:** Bottom sheet showing full venue info when a pin is tapped.

**Props:**
```ts
interface VenueDetailProps {
  venue: Venue
  onClose: () => void
}
```

**Shows:**
- Venue name + "HH Active" badge (purple) or "New" badge (yellow) based on status
- Address, phone (clickable tel: link), website (external link)
- Type badge (if `venue.type` is set)
- Menu photo thumbnail (clickable → opens full image in new tab)
- Menu text in a scrollable `<pre>` box (or "No menu on file yet" placeholder)
- `menu_text_updated_at` formatted date if available
- "📍 Directions" and "⭐ on Google" buttons (both link to Google Maps search)
- Scan call-to-action at the bottom

**File:** `src/components/VenueDetail.tsx`

---

## `MenuCapture.tsx`

**What it does:** Photo capture interface — camera/gallery picker with preview and GPS extraction.

**Props:**
```ts
interface MenuCaptureProps {
  onCapture: (files: File[], gps: { lat: number; lng: number } | null) => void
  onClose: () => void
}
```

**Current behavior (before spec changes):**
- Single file input with `multiple` attribute — user selects 1 or more files at once
- No explicit 4-photo cap (the spec says max 4, current code doesn't enforce it)
- GPS extracted from first photo's EXIF via `extractGpsFromPhoto()` (from `src/lib/gps.ts`)
- Falls back to browser geolocation (`getBrowserLocation()`) if no EXIF GPS
- Preview strip shows all selected thumbnails with ✕ remove buttons
- "Take Photos / Choose from Gallery" button triggers file input

**Spec behavior (after implementation):**
- "Add another photo" button visible while < 4 photos
- GPS extracted from first photo (or browser fallback)
- "Done" button enabled when ≥1 photo captured
- Photo strip read-only during review (no remove buttons)
- On "Done" → calls `onCapture(files, gps)`

**File:** `src/components/MenuCapture.tsx`

**Discrepancy:** The current code does not have a 4-photo cap, no "Add another photo" button, and no "Done" button — it auto-proceeds after the file input selection. The spec and implementation chunks describe an enhanced version that hasn't been implemented yet.

---

## `MenuConfirm.tsx` — **Being Replaced**

**What it does:** Current screen for reviewing parsed menu text before saving. Shows matched venue, parsed text (editable), and source photos.

**Props:**
```ts
interface MenuConfirmProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  parsedText: string
  matchedVenue: Venue | null
  isDuplicate: boolean
  isNotHH: boolean
  existingMenuText?: string | null
  isLoading?: boolean         // true during photo upload + save
  isParsing?: boolean        // true while GPT is parsing photos
  saveError?: string
  onRetry?: () => void
  onConfirm: (menuText: string, venueId?: string) => void
  onReject: () => void
  onClose: () => void
}
```

**UI states:**
- Parsing state: spinner + "Extracting menu text..." button (non-interactive)
- Empty/error state: "No menu text detected" warning + "Type Menu Manually" button
- Normal state: parsed text in a `<textarea>` (editable) or `<div>` (read-only), "Save Menu" button

**Replacement:** `MenuReview.tsx` (planned) — adds a dedicated HH time field, replaces the read-only text display with full editability, adds HH detection failure error state with "Try Again" button.

**File:** `src/components/MenuConfirm.tsx`

---

## `MenuReview.tsx` — **Planned, Not Yet Built**

Per the spec: the replacement for `MenuConfirm`. Will be shown in the `review` scanStep.

**Expected behavior:**
- Shows read-only photo strip (thumbnails of submitted photos)
- **HH time field** — pre-filled by parser, showing detected time patterns like "4-6pm, daily" as a plain text field
- **Menu text box** — pre-filled by parser, fully editable `<textarea>`
- If parser finds NO time patterns → shows error state: *"No happy hour times found. Make sure you're uploading a happy hour menu and try again with better lighting."* with a "Try Again" button that returns to camera
- "Commit Menu" button → calls `onCommit(menuText, hhTime)`
- "Discard" button → discards everything, returns to map

**Spec discrepancy note:** The parser's `checkHappyHour()` currently returns `isHappyHour: boolean + signals: string[]`. The spec says it should also return the specific matched time substrings. The current code does not surface which time pattern matched — only that *something* matched. This would need to be extended for `MenuReview` to properly populate the HH time field with the specific detected times.

**File:** `src/components/MenuReview.tsx` — does not exist yet

---

## `AddVenueForm.tsx`

**What it does:** Manual venue creation form (bottom sheet). Used when `scanStep` is `'newvenue'`.

**Props:**
```ts
interface AddVenueFormProps {
  onClose: () => void
  onVenueAdded: () => void                         // refreshes venue list
  initialCoords?: { lat: number; lng: number }     // GPS from photo (optional)
  onVenueCreated?: (venue: Venue) => void          // called after creation, passes new venue
}
```

**Current fields:**
- Venue name (required)
- Address (required)
- (Phone, website, type fields exist in the DB schema but are NOT in this form)

**Behavior:**
- On submit: if `initialCoords` available, reverse-geocode to fill address
- If address entered but no GPS, forward geocode via `geocodeAddress()`
- Creates venue with `status: 'unverified'`, `contributor_trust: 'new'`
- Calls `onVenueCreated(newVenue)` to set `matchedVenue` and return to `confirm` step

**Spec says:** This form should be simplified — remove geocode call, keep only name field, and after creation redirect to menu scan flow. **This simplification has not been done yet.**

**File:** `src/components/AddVenueForm.tsx`

---

## `VenuePicker.tsx` — **Planned, Not Yet Built**

Per the spec: the screen shown after photo capture if GPS is available.

**Expected behavior:**
- If 0 nearby venues (10m radius) → no UI shown; immediately triggers `onNoNearbyVenue()` → proceeds to `name_entry`
- If 1 nearby venue → shows single venue card: "Are you at [Venue Name]?" with address snippet, Yes/No buttons
- If 2+ nearby venues → shows venue list sorted by distance + "None of these" option at bottom
- "Yes" → `onVenueConfirmed(venue)` → proceeds to `review`
- "None of these" / "No, I'm not here" → `onVenueNotListed()` → proceeds to `name_entry`

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

**File:** `src/components/VenuePicker.tsx` — does not exist yet

---

## `NameEntry.tsx` — **Planned, Not Yet Built**

Per the spec: replaces `AddVenueForm` in the new upload flow. Name-only entry with fuzzy matching.

**Expected behavior:**
1. User types in name field
2. After ≥2 characters: query Supabase for `name ILIKE '%input%'`
3. If match found within ~5km: show "Did you mean: [Name] [address] [distance]?" with Yes/No
4. "Yes" → `onVenueMatched(venue)` → proceeds to `review` (no new venue created)
5. "No" or no match: show "Create [typed name]" button at bottom
6. "Create [name]" → `onVenueCreated(name)` → proceeds to `review`

**Props:**
```ts
interface NameEntryProps {
  gps: { lat: number; lng: number } | null
  onVenueMatched: (venue: Venue) => void
  onVenueCreated: (name: string) => void
  onClose: () => void
}
```

**File:** `src/components/NameEntry.tsx` — does not exist yet

---

## `OnboardingModal.tsx`

**What it does:** Three-step first-time user tour shown once on first visit (stored in `localStorage`).

**Props:**
```ts
interface OnboardingModalProps {
  onClose: () => void
}
```

**Steps:**
1. 📍 Find happy hour venues — browse map/list
2. 📷 Scan a menu — photograph a menu, app reads text
3. 💾 It saves instantly — no account needed

**Hook:** `useOnboarding()` returns `true` on first visit, `false` thereafter. Reads from `localStorage.getItem('pourlist_onboarding_seen')`.

**File:** `src/components/OnboardingModal.tsx`

---

## `VenueCard.tsx`

**What it does:** Individual list item for a venue. Rendered inside `VenueList`.

```ts
// Props (from source):
interface VenueCardProps {
  venue: Venue
  isSelected: boolean
  onClick: () => void
}
```

**File:** `src/components/VenueCard.tsx`

---

## `SupportScreen.tsx`

**What it does:** Developer tip screen. Not fully reviewed — likely a tipping/monetization UI.

**File:** `src/components/SupportScreen.tsx`

---

## Component Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| `Map` | ✅ Built | |
| `SearchBar` | ✅ Built | |
| `VenueList` | ✅ Built | |
| `VenueCard` | ✅ Built | |
| `VenueDetail` | ✅ Built | |
| `MenuCapture` | ✅ Built | Spec says 4-photo cap + "add another" button — not implemented |
| `MenuConfirm` | ✅ Built | Being replaced by `MenuReview` |
| `MenuReview` | 🔨 Planned | Not yet built |
| `AddVenueForm` | ✅ Built | Spec says simplify to name-only — not done |
| `VenuePicker` | 🔨 Planned | Not yet built |
| `NameEntry` | 🔨 Planned | Not yet built |
| `OnboardingModal` | ✅ Built | |
| `SupportScreen` | ✅ Built | |