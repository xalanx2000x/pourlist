# The Pour List — Cato Brief
**For:** Cato (QA / Adversarial Review)
**Date:** 2026-04-16
**Status:** Design phase — nothing is built yet. Review the design, find the holes.

---

## What Is This Project?

A crowd-sourced happy hour directory. Users photograph a bar/restaurant's happy hour menu, AI extracts the text, the text is stored permanently. No accounts. Anonymous device hash for spam prevention.

**Stack:** Next.js 16, Supabase, Mapbox, OpenAI GPT-4o mini, Tailwind

---

## Core Workflow (Current Design)

### Adding a Venue
1. User takes photo of menu at a venue
2. Photo EXIF geotag extracted (phone camera embeds GPS in photo)
3. Browser GPS captured via `navigator.geolocation`
4. EXIF coords vs browser coords → must be within **50m** (proof of presence)
5. **Google Places/Yelp API** called to verify a real business exists at that location
6. If all pass → venue created as `unverified` status
7. GPT-4o mini parses menu text → stored

### Moderation / Removal
- Any user can **flag** a venue as closed/wrong/inappropriate
- Removal requires **N=2 flags → stale** | **N=4 flags → closed**
- **Flagging also requires GPS proof** (EXIF + browser GPS must match)
- Any user can **confirm** a venue is still valid (reverse signal, cancels flags)
- Single device >50% of flags on a venue → those flags discounted
- Sustained abuse → device submission ability disabled

### Updates
- New scan of same venue → menu_text overwritten, last_verified resets
- No editing UI — crowd naturally updates by submitting fresh scans

### Trust System
- Device hash tracks submissions and flags
- New → Trusted after **10 successful submissions**
- Trusted devices' flags carry more weight

---

## Database
- **1,000 venues** in Supabase (all with GPS)
- `venues` table: id, name, lat, lng, zip, type, status, contributor_trust, last_verified, menu_text, menu_text_updated_at, latest_menu_image_url, address_backup
- `photos` table: venue_id, url, uploader_device_hash, lat, lng, status, photo_hash, flagged_count
- `flags` table: venue_id, photo_id, reason, device_hash

**address_backup** = old column renamed, preserved for debugging only

---

## What I Need You To Do

**Your job:** Be the adversary. Find the holes in this design before we build anything.

### Think About:

1. **GPS Spoofing**
   - EXIF geotag can be stripped or faked with metadata editors
   - Browser GPS can be spoofed with VPN, emulator, or location spoofing apps
   - 50m threshold — is this tight enough? Too tight? What's a realistic spoofing setup?
   - What stops a motivated attacker from submitting fake venues from their desk?

2. **The Business Verification Step**
   - We're planning to use Google Places/Yelp API to verify a business exists
   - Can these APIs be spoofed? Can someone register a fake business in Google Places to pass verification?
   - What happens if the API is down, returns wrong data, or has outdated info?

3. **The Flag/Confirm System**
   - Coordinated attack: N bad actors all flag the same legitimate venue simultaneously → venue goes stale/closed
   - Even with GPS proof required for flagging, can someone fake GPS to mass-flag venues?
   - What if an attacker opens Google Maps, goes to a venue's page, and spoofs their GPS to match that venue, then flags it?
   - Reverse attack: mass-confirm a closed venue to reopen it?
   - Can confirmation spam also be a problem? If I confirm venues I haven't visited, does that devalue the system?

4. **The Trust System**
   - Sybil attack: attacker creates 10+ device hashes (new browsers, reset fingerprinting) to get trusted status on each
   - Does 10 submissions to become trusted feel right? Too easy? Too hard?
   - If a device is blocked for abuse, can they trivially generate a new device hash?

5. **Device Hashing**
   - We're using a device hash for anonymous tracking
   - How strong is this fingerprint? Can it be reset trivially?
   - Privacy: what data are we actually collecting? EXIF GPS, browser GPS, device hash — is any of this PII?

6. **Duplicate Detection**
   - When is a submission considered a "duplicate" of an existing venue?
   - What if someone submits the same venue but with a slightly different name or GPS coords that are 60m apart (over the 50m threshold)?
   - The duplicate merge we did for "Life of Riley" — how should the system handle this going forward automatically?

7. **The 999 vs 1000 Problem**
   - We have 1 closed venue (Life of Riley duplicate). What happens when someone tries to submit a venue at that GPS location?
   - Does the closed venue block new submissions nearby? Or does the new submission just get rejected because it's "too close"?

8. **Data Integrity**
   - What stops someone from submitting a venue, then immediately flagging competing venues nearby to reduce competition?
   - Menu text is stored as plain text — what if someone submits inappropriate/offensive content as a "menu"?

9. **Scope Creep**
   - The app is for happy hour venues only. What stops someone from submitting a coffee shop, a dispensary, a laundromat as a "venue"?

10. **Race Conditions / Concurrency**
    - What if two people submit the same venue at the exact same time?
    - What if someone is mid-submission while another flags the venue as closed?
    - What if a venue goes from N-1 flags to N flags (closed) while someone is trying to submit a menu for it?

---

## Output I Want From You

1. **A list of critical vulnerabilities** — the things that would break the app or make it actively harmful
2. **A list of design weaknesses** — things that could be exploited with some effort
3. **A list of edge cases** — things that probably won't happen often but the system should handle gracefully
4. **Suggested mitigations** — if you see a hole, tell me how you'd close it

---

## What Not To Do

- Don't focus on code quality or implementation details (that's for when we build)
- Don't suggest adding user accounts — that's explicitly out of scope
- Don't suggest aggressive friction (CAPTCHAs, approvals, etc.) — the whole value prop is nimble

---

## Context Files

- Full design doc: `STATUS-2026-04-16.md`
- Main spec: `POURLIST.md`
- Project summary: `PROJECT_SUMMARY_2026-04-14.md`

---

Reply here with your analysis. Be harsh. Find the worst-case scenarios.
