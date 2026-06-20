/**
 * Whether a venue has any happy-hour data on file.
 *
 * "Has HH data" = ANY of:
 *   - structured HH window (hh_type, any of the 3 windows)
 *   - extracted menu text (menu_text)
 *   - user-typed HH summary (hh_summary)
 *
 * Without any of these, the venue is a stub — no schedule, no menu,
 * no description. It still gets a public page (so shared links resolve),
 * but with `noindex` and a lighter layout.
 *
 * Single source of truth for the "verified vs unverified" distinction
 * across the app. Used by:
 *   - search ranking (verified venues bubble up)
 *   - search dropdown label (unverified venues show a contribution CTA)
 *   - generateStaticParams (only pre-render venues with content)
 *   - generateMetadata  (noindex venues without content)
 *   - sitemap.ts        (only include venues with content)
 *   - venue page CTA    (positive invitation when no content yet)
 *
 * Future: same flag on map pins to distinguish verified pins from
 * contribution-invitation pins.
 *
 * Renamed from `isIndexable` — the old name reflected one SEO use case;
 * the new name describes what the function actually checks.
 */
import type { Venue } from '@/lib/supabase'

export function hasHappyHourData(
  v: Pick<Venue, 'hh_type' | 'menu_text' | 'hh_summary'>
): boolean {
  return Boolean(v.hh_type || v.menu_text || v.hh_summary)
}