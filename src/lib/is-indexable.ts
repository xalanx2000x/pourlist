/**
 * Whether a venue has enough content to be worth indexing by search engines.
 *
 * Indexable = ANY of: structured HH (hh_type), extracted menu text, or
 * raw user-supplied HH summary. Without any of these, the venue is a
 * seed stub with no schedule, no description — nothing for Google to
 * rank. Those still get a public page (so shared links resolve), but
 * with `noindex` and a lighter layout.
 *
 * Single source of truth — used by:
 *   - generateStaticParams (only pre-render indexable)
 *   - generateMetadata  (noindex non-indexable)
 *   - sitemap.ts        (only include indexable)
 */
import type { Venue } from '@/lib/supabase'

export function isIndexable(v: Pick<Venue, 'hh_type' | 'menu_text' | 'hh_summary'>): boolean {
  return Boolean(v.hh_type || v.menu_text || v.hh_summary)
}
