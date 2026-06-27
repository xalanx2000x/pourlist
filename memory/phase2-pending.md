# Phase 2 — Pending Verification (Phase 3 blockers)

## 3 behaviors NOT tested in Phase 2 (no venue has `new_slug` yet)

### 1. Old → new 301 redirect
**What:** Hit `/venue/{slug}` for an existing pre-Phase-3 venue. Must 301-redirect to `/{state}/{city}/{slug}`.
**Why blocked:** No existing venue has `new_slug` set yet — `/venue/[slug]/page.tsx` can't redirect to a new URL that doesn't exist.
**Test after:** Phase 3 migration populates `new_slug` on ~38 user-created venues.

### 2. Atlantis noindex in real HTML
**What:** A geo-incomplete venue (missing state OR missing city) lands at `/atlantis/{slug}`. Fetch the actual served HTML and confirm `<meta name="robots" content="noindex">` is present.
**Why blocked:** No geo-incomplete venue exists in the DB to test with.
**Test after:** Phase 3 migration sets `needs_geo_review=true` for venues with ambiguous/missing geo.

### 3. Real venue renders at new URL
**What:** A confirmed venue's new `/{state}/{city}/{venueSlug}` URL serves actual page content (name, schedule, menu), not just a 200 skeleton.
**Why blocked:** No venue has `new_slug` set — new-format URL returns 404.
**Test after:** Phase 3 migration populates `new_slug`.

## Phase 2 status
- Commit: `de489bd`
- Deploy: `dpl_EjB1tByn` — READY ✅
- Routing structure: built ✅
- Noindex on /atlantis: intent correct, HTML unverified ❌
- All other routing: verified on temp venues ✅
