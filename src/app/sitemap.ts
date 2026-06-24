/**
 * app/sitemap.ts — Next.js App Router sitemap.
 *
 * Returns only venues with HH data or menu text. Stubs without content
 * are excluded — they have no SEO value.
 */
import type { MetadataRoute } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { venueSlug } from '@/lib/slug'

const BASE_URL = 'https://pourlist.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabaseServer
    .from('venues')
    .select('id, slug, new_slug, name, hh_type, menu_text, hh_summary, last_verified, needs_geo_review, is_seed_data')
    .not('hh_type', 'is', null)
    .order('name')

  const venueEntries: MetadataRoute.Sitemap = (data ?? [])
    .filter(v => {
      // Only geo-complete, non-seed, non-limbo venues with happy hour data
      return (
        hasHappyHourData(v) &&
        v.new_slug !== null &&
        v.is_seed_data !== true &&
        v.needs_geo_review !== true
      )
    })
    .map(v => {
      return {
        url: `${BASE_URL}${v.new_slug}`,
        lastModified: v.last_verified
          ? new Date(v.last_verified)
          : new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      }
    })

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...venueEntries,
  ]
}
