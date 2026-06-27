# PourList — Rule (b): "Every submission leaves the venue complete"

## The rule (enforce identically everywhere)

A submission is valid only if it leaves the venue **complete** = has a menu photo **AND** has HH data.

- **A photo is always required.** No photo → reject.
- **HH data is required** unless the venue *already has* HH data (then a photo-only submission is a valid refresh — but the client always asks for HH anyway; see UX note).
- **Any submission that sets/changes HH must include a photo** (4b).
- **Never null existing HH data.** The destructive `value || null` overwrite is removed.

**Net effect:** incomplete venues can't be created or left incomplete; HH can't be set without a photo; a stray photo-only call can never wipe existing HH.

This is the SAME rule as OSM→user graduation — now applied to every write path. One rule, enforced in three server paths (`commit-menu`, `submit-venue` new-venue, `submit-venue` seed-promotion) and one client flow.

---

## Server rejection-reason contract (client maps these to messages)

Every server reject returns `{ success: false, reason: '<code>' }` with HTTP 4xx. The client maps each `reason` to a user-facing message. Codes:

| reason | meaning | client message |
|---|---|---|
| `missing_photo` | no photo in submission | "A menu photo is required to submit." |
| `missing_hh` | venue has no HH and none provided | "Add the happy hour times to submit this venue." |
| `duplicate` | name+location dedup match | "Looks like {name} is already on PourList nearby." (offer to open it) |
| `photo_upload_failed` | storage upload failed | "Photo upload didn't go through — nothing was saved. Try again." |
| `venue_not_found` / `not_a_seed_venue` | seed promotion target invalid | "Something went wrong with this venue. Try again." |

---

## PART 1 — SERVER: `src/app/api/commit-menu/route.ts`

This path handles existing-venue updates AND can create new venues. Apply the gate **up front, before any write**.

### 1a. Add a completeness gate immediately after parsing the body

Insert this **before** the "Create venue if not existing" block:

```typescript
    // ── Rule (b) completeness gate — validate BEFORE any write ─────────────
    const photoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]

    // A photo is ALWAYS required.
    if (photoFiles.length === 0) {
      return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
    }

    // Does THIS submission carry HH data?
    const hasHhInSubmission = !!(
      hh_type || hh_days || hh_start || hh_end ||
      hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
      hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
      hhTime || hhSummary
    )

    // Determine whether the venue ALREADY has HH (only relevant for existing venues).
    let venueAlreadyHasHh = false
    if (venueId) {
      const { data: existing } = await supabase
        .from('venues')
        .select('hh_type, hh_time')
        .eq('id', venueId)
        .single()
      venueAlreadyHasHh = !!(existing?.hh_type || existing?.hh_time)
    }

    // HH is required UNLESS the (existing) venue already has it.
    // New venues (no venueId) always require HH.
    if (!hasHhInSubmission && !venueAlreadyHasHh) {
      return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
    }
    // ── end gate ───────────────────────────────────────────────────────────
```

> Note: this declares `photoFiles` once at the top — **remove the later `const photoFiles = ...` declaration** inside the photo-upload block (reuse this one).

### 1b. The HH write stays merge-safe (never null)

The current `hasHhFields` / `if (x !== undefined)` block is already non-destructive — **keep it as is.** Under the gate above, it only runs when HH is genuinely provided, and it never writes `null` over an absent field. The gate guarantees completeness; this block guarantees no data loss. Both stay.

The one change: rename the local `hasHhFields` check to reuse `hasHhInSubmission` from the gate (avoid recomputing). Functionally identical.

### 1c. Photo-upload block

Reuse the top-level `photoFiles`. The block is otherwise unchanged (upload, photo_set insert, purge, `latest_menu_image_url` update). Since the gate guarantees `photoFiles.length > 0`, the `if (photoFiles.length > 0)` wrapper is now always true — keep it for safety but it always runs.

---

## PART 2 — SERVER: `src/app/api/submit-venue/route.ts` — NEW VENUE path

This path creates a new venue. Under (b), a new venue ALWAYS requires both photo and HH.

### 2a. Add the gate after the existing field validation (after the `isNaN(venueLat)` check, BEFORE the dedup query)

```typescript
    // ── Rule (b) completeness gate — new venues require photo AND HH ───────
    const photoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]
    if (photoFiles.length === 0) {
      return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
    }
    const hasHhInSubmission = !!(
      hh_type || hh_days || hh_start || hh_end ||
      hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
      hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
      hhSummary
    )
    if (!hasHhInSubmission) {
      return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
    }
    // ── end gate ───────────────────────────────────────────────────────────
```

> Reuse this `photoFiles` for the later upload block — **delete the duplicate `const photoFiles = ...` declaration** further down.

### 2b. Validate-first ordering (fixes the orphan-venue bug)

Currently the venue is INSERTED, then photos upload, then on photo failure the venue is deleted (rollback). With the gate above, a `missing_photo`/`missing_hh` submission is rejected **before** the insert, so no orphan is created for those cases. Keep the existing photo-upload-failure rollback (`delete venue on upload error`) as the backstop for genuine storage failures. Net: no orphans from incomplete submissions; rollback still covers upload failures.

### 2c. The HH-on-insert stays as is

The `venueInsert` object writes HH fields inline (`hh_type: hh_type || null`, etc.). This is fine for a NEW venue — the gate guarantees HH is present, so these write real values, never spurious nulls. No change needed here.

---

## PART 3 — SERVER: `src/app/api/submit-venue/route.ts` — SEED-PROMOTION path (the gap)

**Critical fix.** The seed-promotion path (`if (seedVenueId)`) currently writes a `promotionUpdate` object with NO HH fields — so graduating a seed never captures HH data. Under (b), graduation requires photo AND HH. Two fixes:

### 3a. Add the gate at the top of the `if (seedVenueId)` block (after fetching `seedVenue`, before photo upload)

```typescript
      // ── Rule (b) gate — seed promotion requires photo AND HH ─────────────
      const seedPhotoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]
      if (seedPhotoFiles.length === 0) {
        return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
      }
      const seedHasHh = !!(
        hh_type || hh_days || hh_start || hh_end ||
        hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
        hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
        hhSummary
      )
      if (!seedHasHh) {
        return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
      }
      // ── end gate ─────────────────────────────────────────────────────────
```

> Reuse `seedPhotoFiles` in the existing seed upload loop — replace its local `photoFiles` with `seedPhotoFiles`.

### 3b. Add the HH fields to `promotionUpdate`

In the `promotionUpdate` object, add the HH fields so graduation actually captures them:

```typescript
      const promotionUpdate: Record<string, unknown> = {
        is_seed_data: false,
        city: geoCity,
        state: geoState,
        address: geoAddress ?? '',
        street: geoStreet,
        neighborhood: geoNeighborhood,
        country: geoCountry,
        zip: geoZip,
        address_autofilled: geoAddress !== null,
        // ── HH data (rule b: graduation captures HH) ──
        hh_updated_at: new Date().toISOString(),
        hh_summary: hhSummary?.trim() || null,
        hh_type: hh_type || null,
        hh_days: hh_days || null,
        hh_exclude_days: hh_exclude_days || null,
        hh_start: hh_start ? parseInt(hh_start) : null,
        hh_end: hh_end ? parseInt(hh_end) : null,
        hh_type_2: hh_type_2 || null,
        hh_days_2: hh_days_2 || null,
        hh_exclude_days_2: hh_exclude_days_2 || null,
        hh_start_2: hh_start_2 ? parseInt(hh_start_2) : null,
        hh_end_2: hh_end_2 ? parseInt(hh_end_2) : null,
        hh_type_3: hh_type_3 || null,
        hh_days_3: hh_days_3 || null,
        hh_exclude_days_3: hh_exclude_days_3 || null,
        hh_start_3: hh_start_3 ? parseInt(hh_start_3) : null,
        hh_end_3: hh_end_3 ? parseInt(hh_end_3) : null,
      }
```

> These write real values because the gate guarantees HH is present. The `|| null` here is safe (it's an INSERT-equivalent for a freshly-graduating venue, not an overwrite of existing data).

### 3c. CLIENT must send HH to the seed-promotion call

**Check this in page.tsx:** the seed-promotion fetch (around line 767, the `handleSeedMatch...` path) currently appends `seedVenueId`, `exifLat/Lng`, `phoneLat/Lng`, `deviceHash`, `photos` — but **does it append the HH window fields?** From the code shown, it does NOT. So even with 3a/3b, the client isn't sending HH on seed promotion. **The seed-promotion submit handler must append the same HH window fields that the new-venue path does** (`hh_type`, `hh_days`, `hh_start`, `hh_end`, the _2/_3 windows, `hhSummary`) — using the same `appendWindow` helper. Without this, seed graduation can't satisfy the gate. **This is the most important client fix — confirm the seed path goes through MenuReview (collects HH) and sends it.**

---

## PART 4 — CLIENT: `src/components/MenuReview.tsx`

Flip from "HH optional, save anyway" to "HH required, can't submit incomplete."

### 4a. REMOVE the "Save anyway" warning entirely

Delete `showHhWarning` state and the entire warning block (`{showHhWarning && (...)}`). The "This venue won't show a schedule... Photos will still be saved... Save anyway" flow is the exact mechanism that allowed incomplete venues. It's gone.

### 4b. `handleSave` becomes a hard gate, not a warn-then-allow

```typescript
  async function handleSave() {
    const hasHh = hhWindowsRef.current.some(w => w !== null) || hhSummaryRef.current.trim()
    if (!hasHh) {
      // Hard block — cannot submit without HH. No "save anyway".
      setCommitError('Add the happy hour times above before saving.')
      return
    }
    setCommitError('')
    setIsCommitting(true)
    try {
      const failedInput = failedHhInputRef.current
      failedHhInputRef.current = null
      await onCommit({
        hhWindows: hhWindowsRef.current,
        hhTime: '',
        hhSummary: hhSummaryRef.current,
        failedHhInput: failedInput,
      })
    } catch (err) {
      // err.message is the mapped, user-facing message from page.tsx (see Part 5)
      setCommitError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setIsCommitting(false)
    }
  }
```

### 4c. Disable the Save button until HH is validly entered (clear affordance)

Track whether HH is currently valid (derive from `hhWindows` state already kept in sync via `onChange`):

```typescript
  const hhValid = hhWindows.some(w => w !== null)
```

Update the Save button:

```tsx
        <button
          onClick={handleSave}
          disabled={isCommitting || !hhValid}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {isCommitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            'Save Happy Hour'
          )}
        </button>
```

When `!hhValid`, the button is visibly disabled — the user sees they must enter HH first. Optionally add a subtle helper line under it when disabled: *"Enter the happy hour times above to save."*

### 4d. Photo is guaranteed present

MenuReview is only reached after MenuCapture (which requires ≥1 photo — `handleDone` returns early if `files.length === 0`). So the photo requirement is already satisfied by the flow; no extra client check needed. The server gate is the backstop.

---

## PART 5 — CLIENT: `src/components/HHScheduleInput.tsx`

### 5a. Remove the immediate-submit bypass (the double-path bug)

Currently "Confirm Happy Hour" inside HHScheduleInput can fire `onCommit` → submits immediately, bypassing MenuReview's gate. There must be **ONE submission path** (MenuReview's Save button).

Change: HHScheduleInput's commit action should only **sync the windows up to the parent** (via the existing `onChange` / the `onCommit` that just stores into `hhWindowsRef`), **NOT trigger the actual save.** The actual submit happens ONLY via MenuReview's Save button.

Concretely: in MenuReview, the `HHScheduleInput`'s `onCommit` handler currently just stores refs (good — keep that). But `handleHhScheduleCommit` (the OTHER onCommit handler that calls `onCommit({...})` → submits) must be **removed or rewired** so confirming HH inside the input does NOT fire a submission. The input confirms/syncs; the footer Save button submits. One path.

> Verify which `onCommit` MenuReview actually passes to HHScheduleInput — wire it to the **sync-only** version (stores into `hhWindowsRef`/`hhSummaryRef`), never the submitting one.

---

## PART 6 — CLIENT: `src/app/page.tsx` — `handleMenuCommit` + seed handler

### 6a. Map server `reason` codes to user-facing messages

In `handleMenuCommit`, where it currently does `throw new Error(err.error || 'Failed to save menu')`, replace with a reason→message mapper applied to BOTH the commit-menu and submit-venue responses:

```typescript
  function messageForReason(reason: string | undefined, fallback: string): string {
    switch (reason) {
      case 'missing_photo':       return 'A menu photo is required to submit.'
      case 'missing_hh':          return 'Add the happy hour times to submit this venue.'
      case 'duplicate':           return 'This venue is already on PourList nearby.'
      case 'photo_upload_failed': return 'Photo upload didn’t go through — nothing was saved. Please try again.'
      case 'venue_not_found':
      case 'not_a_seed_venue':    return 'Something went wrong with this venue. Please try again.'
      default:                    return fallback
    }
  }
```

After each fetch:

```typescript
      const result = await commitRes.json().catch(() => ({}))
      if (!commitRes.ok || !result.success) {
        throw new Error(messageForReason(result.reason, result.error || 'Failed to save. Please try again.'))
      }
```

The thrown message surfaces in MenuReview's `commitError` (Part 4b), preserving the user's entered data — they fix the issue and resubmit.

### 6b. Seed-promotion handler must send HH (ties to Part 3c)

In the seed-promotion submit (the `handleSeedMatch...`/promotion path that posts to `/api/submit-venue` with `seedVenueId`), **append the HH window fields** exactly as the new-venue path does (the `appendWindow` helper + `hhSummary`). The seed flow must route through MenuReview (so HH is collected) before this submit. Confirm the seed-confirm flow reaches MenuReview.

### 6c. Success messages (per case)

Keep the existing `setSaveSuccess(true)` + `setLastSavedVenue(...)` pattern, with case-appropriate text:
- New venue: `"{name} added"`
- Existing venue update: `"{name} updated"`
- Seed promotion: `"{name} verified"`

### 6d. Double-submit guard

`isCommitting` in MenuReview already disables the button during flight (Part 4c). Confirm `handleMenuCommit` can't be re-entered (the disabled button covers the UI path; the `isCommitting` flag is sufficient).

---

## VERIFICATION (before deploy → after deploy)

Build locally (`npm run build`) — must pass. Then, after deploy, test each case live:

1. **New venue, photo + HH** → saves, appears on map. ✓
2. **New venue, photo, NO HH** → Save button disabled; if forced, server rejects `missing_hh`, message shown, input preserved. ✓
3. **New venue, HH but somehow no photo** → server rejects `missing_photo`. (Flow shouldn't allow it, but backstop works.) ✓
4. **Existing venue with HH, re-scan with photo + same HH** → updates, HH intact. ✓
5. **Existing venue with HH, photo-only call (simulated)** → HH NOT nulled (the Paymaster bug — confirm it can't recur). ✓
6. **Seed promotion, photo + HH** → graduates WITH HH data captured (the gap fixed). ✓
7. **Seed promotion, no HH** → rejected `missing_hh`. ✓
8. **No "Save anyway" path exists anywhere.** ✓

The key regression test is **#5** — confirm a photo-only update to a venue that has HH leaves the HH untouched. That's the bug that started this.

---

## SUMMARY OF FILES CHANGED

| File | Change |
|---|---|
| `api/commit-menu/route.ts` | Up-front (b) gate; keep merge-safe HH write; reuse single `photoFiles` |
| `api/submit-venue/route.ts` (new venue) | Up-front (b) gate; validate before insert |
| `api/submit-venue/route.ts` (seed promotion) | (b) gate + add HH fields to `promotionUpdate` (the gap) |
| `components/MenuReview.tsx` | Remove "Save anyway" warning; hard HH gate; disable Save until HH valid |
| `components/HHScheduleInput.tsx` | Remove immediate-submit bypass — one submission path |
| `app/page.tsx` | reason→message mapper; seed handler sends HH; success messages |

**Discipline:** `npm run build` locally before push. No migration needed (no schema change). Deploy, then verify all 8 cases live — especially #5 (HH not nulled) and #6 (seed graduation captures HH).
