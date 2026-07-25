# PourList Architecture

## Mapbox Token Strategy

Two separate Mapbox tokens exist for distinct security and capability profiles:

| Token | Env Var | Type | Restrictions | Used By |
|---|---|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.eyJ...` | Publishable (client-side) | Restricted to app pourlist.app URLs | `mapbox-gl` in browser; map rendering in MapboxMap.tsx |
| `MAPBOX_SERVER_TOKEN` | (encrypted on Vercel) | Server-side secret | No URL allowlist; unrestricted API access | Server-side geocoding, reverse geocoding, boundary API calls in Next.js Route Handlers |

**Why two?** The publishable token is intentionally restricted to PourList domains in the Mapbox dashboard. If this token leaks, exposure is limited to map rendering on the approved domain. The server token has no URL restrictions and is used exclusively in server-side code for geocoding and the Boundaries API — it must never reach the client. Consolidating them into one token would remove the restricted-domain safeguard.

**Rule:** Never expose `MAPBOX_SERVER_TOKEN` as `NEXT_PUBLIC_*`. Never log or print token values.

---

## Neighborhood Name System

### Two independent name sources

**`neighborhood_zones`** — Polygon-based lookup (PostGIS)

For cities with drawn GeoJSON zone polygons (e.g. New York), neighborhood names are managed exclusively through this table. Names come from the GeoJSON `name` property. No text lookup is involved.

```sql
neighborhood_zones (
  id           UUID PRIMARY KEY,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  display_name TEXT NOT NULL,   -- e.g. 'Upper West Side'
  geometry     geography(Polygon, 4326),
  is_active    BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
```

**`neighborhood_map`** — Text-based lookup (plain SQL)

For cities without zone polygons, raw Mapbox neighborhood names are mapped to display names via text lookup. This is the legacy/fallback system. Never populate `neighborhood_map` rows for a city that also has zone polygons.

```sql
neighborhood_map (
  id                UUID PRIMARY KEY,
  city              TEXT NOT NULL,
  state             TEXT NOT NULL,
  mapbox_neighborhood TEXT NOT NULL,   -- raw Mapbox name
  display_name      TEXT NOT NULL,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  UNIQUE (city, state, mapbox_neighborhood)
)
```

### Resolution priority (at write time)

```
1. Zone polygon lookup  →  zone.is_active=true wins, returns zone.display_name
2. Text mapping lookup  →  neighborhood_map match wins, returns display_name
3. Raw Mapbox name      →  no zone, no mapping; return as-is
```

### `is_active` lifecycle

- Ingestion: always `false` (pending review)
- Activation: flip to `true` only after Tyler confirms the zone name list
- Only Manhattan zones are activated initially; Brooklyn/Queens/Bronx/NJ/Westchester stored but inactive

---

## Service Role / RLS Default

All admin-only tables (neighborhood_map, neighborhood_zones, etc.) use:

```sql
CREATE POLICY "<name>_admin_all" ON <table>
  FOR ALL USING (auth.role() = 'service_role');
```

**Never use `USING (true)`** on non-public tables — it exposes data to the anon key.

---

## Key Files

- `src/lib/neighborhood-substitution.ts` — write-time lookup, zone-first then text
- `src/app/api/seed/venue/route.ts` — handleNew, handleEdit, handleGeocode call substituteNeighborhood
- `src/app/api/seed/neighborhoods/route.ts` — CSV export/import for neighborhood_map
