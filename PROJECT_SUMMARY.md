# The Pour List — Project Summary
**Last updated:** 2026-04-12 17:01 PDT
**Repo:** `/Users/livingroom/.openclaw/workspace/pourlist`
**Dev server:** `npm run dev` → `localhost:3000`
**Supabase:** `https://cuzkquenafzebdqbuwfk.supabase.co`

---

## What This Project Is

**The Pour List** is a crowd-sourced happy hour directory for Portland, Oregon. Mobile-first PWA built with Next.js 16 + Supabase + Mapbox.

**Core workflow:** User photographs a happy hour menu → GPT-4o mini extracts the text → venue is matched or created → menu text is permanently stored. No accounts. Device fingerprint is the anonymous identity.

**Stack:**
- Frontend: Next.js 16 (App Router), Tailwind CSS, TypeScript
- Backend: Next.js API Routes (Edge)
- Database: Supabase (PostgreSQL + Auth + Storage)
- Maps: Mapbox GL JS (`mapbox://styles/mapbox/streets-v12`)
- AI: OpenAI GPT-4o mini (`/api/parse-menu` — base64-encoded image → text extraction)
- Geocoding: Mapbox Geocoding API (primary) → Nominatim (fallback)
- Payments: Solana USDC via CrossMint API
- Identity: did:key (Ed25519) with Verifiable Credentials — no external DID infrastructure needed

---

## What This Document Covers

This is a comprehensive reference for any AI agent or developer continuing this project. It covers the database schema, every file, the happy hour detection logic, the menu submission workflow, the MCP/agent layer, the payment infrastructure, the identity system, and all open items.

---

## 1. Environment Variables

All stored in `.env.local` (gitignored — never commit this):

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1IjoicG91cmxpc3Q...
NEXT_PUBLIC_SUPABASE_URL=https://cuzkquenafzebdqbuwfk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
OPENAI_API_KEY=sk-proj-StSM2KpuMTSA9RQlS8RTbkJUlwv7uIuBM40bFlsDzs3...
SUPABASE_SERVICE_ROLE_KEY=[REDACTED]

# CrossMint (payment verification)
CROSSMINT_API_KEY=sk_production_...
CROSSMINT_WALLET_ADDRESS=FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8

# Ceramic DID seed (24-word mnemonic — never commit)
CERAMIC_SEED_PHRASE=garden route enjoy idol system chat helmet heroin invest shark body major away digital silence outside rest baby behave sheriff cook card policy pearl
```

---

## 2. Supabase Database Schema

### `venues` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Auto-generated |
| `name` | `text` NOT NULL | Venue name |
| `address` | `text` NOT NULL | Street address |
| `lat` / `lng` | `double precision` | GPS coordinates |
| `zip` | `text` | Hardcoded to `'97209'` (Pearl District) |
| `phone` | `text` | Optional |
| `website` | `text` | Optional |
| `type` | `text` | e.g. "Bar", "Restaurant" |
| `status` | `text` | `'unverified'` / `'verified'` / `'stale'` / `'closed'` |
| `menu_text` | `text` | HH menu content — primary data field |
| `menu_text_updated_at` | `timestamptz` | When menu was last saved |
| `latest_menu_image_url` | `text` | One reference photo per venue |
| `created_at` | `timestamptz` | Default `now()` |

### `photos` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `venue_id` | `uuid` FK → venues | |
| `url` | `text` NOT NULL | Public Supabase Storage URL |
| `uploader_device_hash` | `text` NOT NULL | Anonymous device identity |
| `lat` / `lng` | `double precision` | GPS where photo was taken |
| `status` | `text` | `'pending'` / `'approved'` / `'rejected'` |
| `photo_hash` | `text` | Future deduplication |

### `flags` table — moderation
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `venue_id` / `photo_id` | `uuid` FK (nullable) | |
| `reason` | `text` NOT NULL | |
| `device_hash` | `text` NOT NULL | |

### `events` table — analytics
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `event_name` | `text` NOT NULL | e.g. `'menu_save_success'` |
| `device_hash` | `text` NOT NULL | Real hash from `getDeviceHash()` |
| `venue_id` | `uuid` FK (nullable) | |
| `metadata` | `jsonb` | Flexible extra data |
| `created_at` | `timestamptz` | |

**Storage bucket:** `'venue-photos'` — exists, public.

**RLS:** Public read/write on all tables (no auth — intentional for anonymous UX).

**Migration status:** Schema applied via Supabase Dashboard SQL Editor. Last migration: `001_events_and_columns.sql` (applied 2026-04-12).

---

## 3. File Structure

```
pourlist/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main home page (map + list + scan workflow)
│   │   ├── layout.tsx                  # Root layout, PWA manifest, SW registration
│   │   └── api/
│   │       ├── parse-menu/route.ts     # POST — GPT-4o mini image→text extraction
│   │       ├── submit-menu/route.ts    # POST — create/update venue + menu_text
│   │       ├── upload-photo/route.ts   # POST — Supabase Storage upload
│   │       ├── check-duplicate/route.ts # POST — duplicate menu detection
│   │       ├── track-event/route.ts    # POST — analytics events
│   │       ├── mcp/route.ts            # MCP server (JSON-RPC 2.0, agent-facing)
│   │       └── pricing/route.ts        # GET /api/pricing — payment manifest
│   ├── components/
│   │   ├── Map.tsx                     # Mapbox GL map, purple HH markers
│   │   ├── VenueList.tsx               # Scrollable venue list, HH count badge
│   │   ├── VenueCard.tsx               # Single venue row, "HH Active" purple badge
│   │   ├── VenueDetail.tsx            # Slide-up venue detail panel
│   │   ├── AddVenueForm.tsx            # Manual venue creation
│   │   ├── MenuCapture.tsx             # Photo picker (gallery + camera)
│   │   ├── MenuConfirm.tsx             # Review parsed text, save/retry/cancel
│   │   └── OnboardingModal.tsx         # 3-step first-run tour (shows once)
│   └── lib/
│       ├── supabase.ts                 # Supabase client + Venue/Photo/Flag types
│       ├── venues.ts                   # getVenuesByZip, getVenueById, addVenue
│       ├── happyHourCheck.ts           # Detects HH signals in parsed text
│       ├── activeHH.ts                  # Time-aware active HH detection (current time vs menu)
│       ├── analytics.ts                # trackEvent() → POST /api/track-event
│       ├── rateLimit.ts                # Client-side: 2min unlimited → 1/2min
│       ├── device.ts                   # getDeviceHash() — anonymous fingerprint
│       ├── gps.ts                      # extractGpsFromPhoto, getBrowserLocation, reverseGeocode
│       ├── payments.ts                 # CrossMint client, PRICING, createPaymentOrder, verifyPayment
│       ├── did.ts                      # did:key generation, VC issuance + verification
│       ├── imageResize.ts              # fileToBase64 (resize to ≤3MB)
│       └── imageHash.ts               # fingerprintFile (dedup)
├── public/
│   ├── manifest.json                   # PWA manifest (display: standalone)
│   ├── sw.js                           # Service worker (stale-while-revalidate)
│   └── .well-known/
│       └── ai-plugin.json             # OpenAI plugin manifest (agent discovery)
├── migrations/
│   └── 001_events_and_columns.sql      # Applied 2026-04-12
├── supabase-schema.sql                  # Full current schema
└── .env.local                          # All secrets (gitignored)
```

---

## 4. Happy Hour Detection

### `happyHourCheck.ts` — Extraction time
Scans parsed GPT text for signals: HH keywords, time windows, discount language, day-of-week patterns, HH-specific food/drink items. Used at submission time to warn users if a submitted menu doesn't look like a happy hour menu.

### `activeHH.ts` — Display time
Time-aware. Checks current clock hour + day against time windows found in stored `menu_text`. Supports:
- Explicit windows: `"3-6pm"`, `"4pm - 7pm"`, `"5 to 8"`
- Day-of-week specificity: `"Mon-Fri 4-7pm"`
- Day ranges: `"Mon-Fri"` (assumes weekdays include today)
- Pure HH keyword mention without time restriction

**Visual indicators:**
- **Purple map markers** (`#7c3aed`) for venues where `hasActiveHappyHour(venue.menu_text)` = true
- **"HH Active" badge** on venue cards and detail panel
- **VenueList header** shows active HH count (e.g. "42 venues · 7 with active HH")

---

## 5. Menu Submission Workflow

```
User taps "Scan Happy Hour Menu"
  → MenuCapture (choose/camera → preview)
    → handleCapture():
        1. fileToBase64() all photos (resize ≤3MB)
        2. extractGpsFromPhoto() from EXIF → getBrowserLocation() fallback
        3. Find nearby venue within 50m via getVenuesByZip()
        4. POST /api/parse-menu for each page (base64 → GPT-4o mini)
           - trackEvent('menu_parse_success' / 'menu_parse_failure')
        5. checkHappyHour() on combined text → isNotHH warning if empty
        6. → MenuConfirm screen
    → handleMenuConfirm(menuText, venueId?):
        a. getDeviceHash() → checkRateLimit() — 2min unlimited, then 1/2min
        b. POST /api/upload-photo (first photo → Supabase Storage 'venue-photos')
        c. POST /api/submit-menu { menuText, venueId, venueName, lat, lng, imageUrl, deviceHash }
           - trackEvent('menu_save_success' / 'menu_save_failure')
        d. loadVenues() refresh
        e. Show "✓ Saved" green banner for 3s
        f. Reset workflow
```

**Retry path:** "Try Again" button in MenuConfirm re-triggers the save with the same parsed text.

---

## 6. Rate Limiting

**File:** `src/lib/rateLimit.ts`

| Window | Rule |
|---|---|
| 0–2 min after first submission | Unlimited submissions |
| 2+ min since last submission | 1 per 2 minutes |

Client-side only (localStorage), per device hash. Tamper-savvy users can bypass — not the threat model.

---

## 7. Analytics

**Table:** `events` (migrated 2026-04-12)  
**Instrumentation:** `src/lib/analytics.ts` → `POST /api/track-event` → Supabase  
**Behavior:** Fire-and-forget. API always returns 200. Failures are silent.

| Event | When fired | metadata |
|---|---|---|
| `menu_parse_success` | GPT returns text | `{ pageCount: number }` |
| `menu_parse_failure` | No text extracted | — |
| `menu_save_success` | Save to DB succeeds | `venueId` |
| `menu_save_failure` | Save to DB fails | `{ error: string }` |
| `venue_view` | Map pin or list row tapped | `venueId` |
| `onboarding_complete` | User finishes all 3 steps | — |
| `onboarding_skip` | User taps "Skip tour" | — |

**Device hash:** Real hash from `getDeviceHash()` (not hardcoded).

---

## 8. PWA / Offline Support

**Service worker:** `public/sw.js`  
**Registered in:** `src/app/layout.tsx` (production only via `useEffect`)

**Strategy:**
- Static assets (HTML/JS/CSS): **cache-first** with network fallback
- API requests: **stale-while-revalidate** (always hit network, use cache on failure)
- Up to 5 minute cache age for API responses

**Manifest:** `public/manifest.json` — `display: standalone`, theme `#f59e0b`

---

## 9. MCP / Agent Layer (AP2 Foundation)

**File:** `src/app/api/mcp/route.ts`  
**Transport:** Streamable HTTP (JSON-RPC 2.0) at `POST /api/mcp`  
**Discovery:** `GET /api/mcp` (server manifest), `GET /.well-known/ai-plugin.json` (OpenAI plugin)

### Tools exposed

| Tool | Description | Access |
|---|---|---|
| `find_venues` | List Pearl District venues, filter by active HH | Free |
| `find_venues` + `includeHistorical: true` | Historical HH data for market research | Premium ($0.01 USDC) |
| `get_venue_details` | Basic venue info (name, address, status) | Free |
| `get_venue_details` `detail: 'full'` | Full menu text | Premium ($0.001 USDC) |
| `get_active_happy_hours` | Time-aware currently active HH venues | Free |
| `submit_menu_update` | Store/update menu text | Free |
| `get_issuer_did` | Returns PourList server DID | Free |
| `authorize_agent` | Issue VC JWT for agent authorization | Free |

### Payment flow (AP2-compatible 402 pattern)

```
1. Agent calls premium operation (e.g., detail: 'full')
2. Server returns 402 + payment manifest:
   { paymentAddress, amount (USDC), orderId, instructions }
3. Agent prompts user's wallet to pay on-chain
4. User signs transaction → wallet returns Solana tx signature (base58)
5. Agent retries MCP call with transactionId parameter
6. Server verifies via CrossMint API
7. If verified → premium data. If unverified → 403.
```

**Pricing manifest:** `GET /api/pricing` returns the full operation cost schedule.

---

## 10. Payment Infrastructure

**Files:** `src/lib/payments.ts`, `src/app/api/pricing/route.ts`  
**Rail:** Solana USDC  
**Verification:** CrossMint Wallet API  
**Receiving address:** `FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8` (Solana)

### Pricing tiers

| Operation | Params | Price |
|---|---|---|
| `find_venues` | basic | Free |
| `get_active_happy_hours` | — | Free |
| `get_venue_details` | `detail: 'summary'` | Free |
| `submit_menu_update` | — | Free |
| `get_venue_details` | `detail: 'full'` | $0.001 USDC |
| `find_venues` | `includeHistorical: true` | $0.01 USDC |

Payments go to the Solana address above. Agents pay by sending USDC on Solana and providing the transaction signature as `transactionId` in their MCP tool call. Server verifies via CrossMint.

---

## 11. Decentralized Identity (did:key + VC)

**File:** `src/lib/did.ts`  
**Method:** did:key (Ed25519) — no external DID infrastructure, Ceramic seed phrase derives identity fully offline.

### How it works

```
Agent's DID (provided on first auth)
  → POST /api/mcp { method: 'authorize_agent', params: { agentDid, requestedCapabilities } }
    → Server issues short-lived VC JWT (1h default, max 24h)
      → Agent presents VC in subsequent MCP calls
        → Server verifies VC signature + expiry + capabilities
          → Grants or denies access to operations
```

### Key functions

- `generateDidFromSeed(phrase)` → `did:key:z6MksV...` (base58-encoded Ed25519)
- `issueVC(subjectDid, capabilities[], expiresIn)` → signed JWT VC
- `verifyVC(vcJwt)` → `{ subject, capabilities, valid }` or null
- `logServerDid()` → logs + returns the PourList server DID

### Server DID

`did:key:z...` derived from `CERAMIC_SEED_PHRASE` in `.env.local`.

### Capabilities

VC grants authority for specific PourList operations: `find_venues`, `get_venue_details`, `get_active_happy_hours`, `submit_menu_update`, `premium_data`.

---

## 12. Key Decisions Made

| Decision | Rationale |
|---|---|
| Mapbox over Google Maps | Free tier sufficient |
| No user accounts | Anonymous identity via device hash — frictionless UX |
| Menu text stored, photo discarded | Privacy + permanent storage |
| GPT-4o mini for parsing | $0.0003/photo — essentially free |
| Mapbox primary geocoding | 100k/month free on existing token; Nominatim fallback |
| Client-side rate limiting | Tamper-aware users are not the threat model |
| Fire-and-forget analytics | Failures must never impact UX |
| Purple = active HH | Distinct from amber unverified markers |
| did:key over full Ceramic Node | Fully offline, no external infrastructure needed |
| Solana USDC over Bitcoin | Speed + stability for micro-payments |
| CrossMint for payment verification | No self-hosted blockchain RPC needed |

---

## 13. Onboarding Tour

**File:** `src/components/OnboardingModal.tsx`  
**Trigger:** First visit only — `pourlist_onboarding_seen` localStorage key

3 steps:
1. 📍 Find happy hour venues — browse map or list
2. 📷 Scan a menu — photograph and AI reads it
3. 💾 It saves instantly — no account needed

---

## 14. Running the Project

```bash
# Development
npm run dev        # localhost:3000

# Production
npm run build
npm start          # production server
```

No pending migrations — schema fully applied.

---

## 15. Open Items & Technical Debt

### Post-launch (nice to have)
- [ ] **Text search** — venue name or cuisine filter (currently radius-only)
- [ ] **Offline venue writes** — newly submitted venues disappear on refresh until reconnect
- [ ] **Duplicate detection UI** — `isDuplicate` tracked but no blocking confirmation, just a warning
- [ ] **Photo retry UI** — failed Storage upload requires restart from MenuCapture
- [ ] **Real-world user test** — 61 Pearl District venues seeded, no real submissions yet

### AP2 / agent monetization (future)
- [ ] **Payment flow testing** — real USDC transactions on CrossMint (needs volume)
- [ ] **A2A Protocol** — agent-to-agent collaboration via MCP wrapper
- [ ] **Ceramic Clay testnet node** — for persistent cross-device DID (optional, current did:key works offline)

---

_This document is the authoritative source for project state as of 2026-04-12 17:01 PDT. Update it after any significant architectural change._