# Pour List — Cato QA Brief
**For:** Cato (QA / Adversarial Fault-Finding)
**Date:** 2026-04-16
**Stage:** Pre-implementation design review

---

## What Is The Pour List?

A crowd-sourced happy hour directory. Users photograph a bar/restaurant's happy hour menu with their phone camera, GPT-4o mini extracts the text, and the parsed menu is stored permanently. The photo is discarded after parsing. No accounts — anonymous device hash for spam prevention.

**Stack:** Next.js 16, Supabase, Mapbox, OpenAI GPT-4o mini, Tailwind

---

## The New System — What You Need to Review

### 1. Venue Addition (GPS + EXIF Matching)

**The flow:**
1. User takes photo of menu → photo has EXIF geotag from phone camera
2. Browser captures GPS via `navigator.geolocation`
3. Both coordinates must be within ~50m to be accepted
4. No EXIF or GPS → submission rejected (no exceptions)
5. Device hash tracked for reputation

**Your adversarial questions:**
- Can someone bypass the EXIF check? (e.g., manually add EXIF to fake photo)
- Can browser GPS be spoofed? (yes, at OS level — how much does this matter?)
- What happens if someone submits from 49.9m away? (edge case)
- Can the 50m threshold be gamed by adjusting photo location metadata?
- Does the GPS check happen client-side or server-side? (Should be server-side)

### 2. Google Places Verification

**The flow:**
- New venue submissions verified against Google Places API
- Confirms a real business exists at that location before accepting

**Your adversarial questions:**
- What happens if Google Places doesn't have the venue? (False negatives)
- Can someone register a fake Google Places entry to pass verification?
- Does Google Places API cost scale with users? (Cost attack vector)
- Can we cache Places results to reduce API calls? (Stale data risk)

### 3. Moderation: Flag/Confirm System

**The flow:**
- Any user flags a venue as closed/wrong (requires GPS proof, same as addition)
- N=2 flags → `'stale'` (hidden)
- N=4 flags → `'closed'` (fully hidden)
- "I'm here, it's still valid" → reverse signal, cancels flags
- Soft delete only — closed venues can be reopened

**Device trust:**
- 10 successful submissions → `'trusted'`
- Trusted flags count more
- Single device >50% of flags on any venue → flags discounted
- Abuse pattern → submission disabled

**Your adversarial questions:**

*Flagging abuse:*
- Can someone create multiple device hashes to accumulate flags on one venue?
- Can a competitor flag all neighboring venues to monopolize traffic?
- Does the GPS proof requirement for flagging actually stop remote abuse?
- What if someone flags a venue while actually there (legitimate) but it's actually a legitimate venue? (False positive)
- Can someone visit a venue, flag it, then immediately submit a "correction" to take it over?

*Stale/closed state:*
- Can a venue that's actually open be淹没 by coordinated flagging before trusted users can counteract?
- How quickly can trusted users reverse a bad flag? Is there a race condition?
- What happens if a venue is legitimately closed permanently vs. temporarily (seasonal)?

*Device reputation:*
- How hard is it to generate new device hashes?
- If submission is disabled for an abuser, can they clear cookies/localStorage and get a fresh hash?
- Does the trust level persist across browser sessions?

### 4. Data Integrity

**Current state:**
- 1,000 venues seeded from OSM (all have lat/lng)
- 1 duplicate merged (Life of Riley)
- All venues have GPS ✅

**Your adversarial questions:**
- The OSM seed data — how verified is it? Are any of those venues actually closed?
- Can duplicate venues be submitted by users, creating multiple entries for the same physical location?
- If two users submit the same venue independently, what happens?
- What if someone submits a venue with slightly different name (e.g., "Bar & Grill" vs "Bar and Grill")?

---

## Known Edge Cases to Test

### Geolocation Edge Cases
1. Photo EXIF says venue is at coordinates X, browser GPS says coordinates Y — exactly 50m apart. Does it pass or fail?
2. Photo has EXIF but browser GPS fails (permission denied or timeout). What happens?
3. Browser GPS works but photo has no EXIF. Rejected. Good.
4. User is inside a large building — GPS accuracy might be 50-100m even when at correct venue. False rejections?
5. Very old phone that doesn't embed GPS in EXIF. No submission possible. Intentional?

### Reputation Edge Cases
1. User submits 9 venues legitimately → not yet trusted. Their 10th submission fails?
2. User reaches trusted status, then clears browser data → back to 'new'? Or does hash persist?
3. User with 'trusted' status submits a clearly fake venue. Does their trust protect it from immediate flagging?

### Moderation Edge Cases
1. Venue accumulates 2 flags → stale. But a trusted user confirms "I'm here, it's valid." Does it immediately restore?
2. Venue has 3 flags (1 short of closed). 5 trusted users visit and flag. Does it immediately go to closed?
3. Someone flags a venue that's actually a residential address (not a bar). What verification exists?
4. Flag reason is "wrong" — how is that adjudicated? Who decides what's wrong?

### Submission Flow Edge Cases
1. User takes photo, closes app, reopens — does the submission persist?
2. User submits menu, it goes to GPT-4o mini for parsing, GPT fails or times out. What user feedback?
3. Very long menu text — does it truncate? Is there a max length?
4. Non-English menu — does GPT handle it? What's the UX for a rejected parse?

---

## What We Want You To Do

1. **Review the design** for blind spots — things we haven't considered
2. **Attack the threat model** — what abuse vectors exist that we haven't addressed?
3. **Identify edge cases** we need to handle in code
4. **Flag unrealistic assumptions** — things we assume work but might not
5. **Suggest improvements** to any part of the system

Focus on: **adversarial fault-finding**. Don't assume attackers play by the rules.

---

## Key Files

- `/pourlist/src/lib/supabase.ts` — Venue/Photo/Flag types
- `/pourlist/src/lib/venues.ts` — getVenuesByProximity, createVenueForScan, flagContent
- `/pourlist/src/lib/device.ts` — getDeviceHash (fingerprinting)
- `/pourlist/src/lib/gps.ts` — extractGpsFromPhoto, getBrowserLocation
- `/pourlist/src/components/VenueDetail.tsx` — venue display
- `/pourlist/src/components/MenuCapture.tsx` — camera/gallery capture
- `/pourlist/STATUS-2026-04-16.md` — full project status

---

## Contact / Handoff

If you find something critical: document it in `memory/YYYY-MM-DD.md` and ping Tyler in the main session.

For implementation issues or code-level bugs: open a GitHub issue or PR.

---

_This brief is for Cato only. Do not share outside the agent team._
