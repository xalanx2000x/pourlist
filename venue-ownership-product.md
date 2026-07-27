# Venue Ownership Product (in progress)

The model: venues pay to claim their page. $49/year. Verified profile editing, photos, daily specials. While claimed, public submissions are disabled for that venue (no submit button — the absence is the ownership signal). At expiry, access reverts to public; owner content and an "Owner-updated · [date]" marker persist.

The keystone principle: venues author content, users author delivery rules, money never crosses that line. Paid radius push notifications were considered and rejected — per-venue rate limits don't cap what a user receives, and selling notification reach converts consent-to-information into purchased attention.

Accepted risk, revisit at scale: claimed pages have no public correction path. A venue that pays and then closes stays wrong until term expiry. No reporting affordance was built — deliberate, since there's no team to triage reports.

Verification: manual. Owner submits a claim request; Tyler calls the venue's listed phone number (from the venues table / Google) to verify authority. Automated Twilio callback is a later option at volume.

## Shipped

- `claim_requests` table — venue_id, contact_name, phone, email, note, status, admin_note, created_at. RLS enabled, zero policies (deny-by-default; holds PII; service-role client bypasses). Migrations 018, 019.
- `/api/claim-request` — public POST, 24h per-venue spam guard, honeypot field
- `ClaimVenueButton` + `ClaimVenueModal` — renders on SEO venue page (both branches) and in-map `VenueDetail` card. Modal uses `createPortal` to `document.body` (`VenueDetail`'s overflow container clips it otherwise) and forces `scrollTop = 0` on mount.
- `/verification` — admin call sheet, `/seed` auth (same `SEED_PASSWORD` and cookie). Shows listed # vs provided #, status workflow (new/contacted/verified/closed), admin notes, age flagging past 2 days.
- `/devdash` claim requests panel

## Not built (planned, dormant until first paying customer)

- **Magic-link token infrastructure** — signed per-venue token → `/claim/[token]` → sets scoped cookie → redirects to `/manage`
- **`/manage`** — owner edit page. No venue ID in URL; the cookie names the venue. Subset of the `/seed` form: HH schedule, photos, summary, phone, website, daily special. Never status, is_seed_data, geocoding, lat/lng, slug, close, or delete.
- **`/api/manage/venue`** — scoped route, content fields only, one venue. Not a reuse of the seed routes.
- **Schema additions when built:** `claimed_until`, `claim_contact_email` on `venues`
- **Payment:** manual Stripe payment link, issued by hand after a successful verification call

## Also planned

- **Device-local venue favorites** (no accounts — a device preference, not an identity)
- **User-configured nearby alerts** (off by default)

Favorites are the follower asset that would justify a premium tier later; do not market this until it exists.
