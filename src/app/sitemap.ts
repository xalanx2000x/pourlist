/**
 * app/sitemap.ts — Next.js App Router sitemap.
 *
 * Returns only indexable venues (those with HH data or menu text).
 * Non-indexable stubs are excluded — they have no SEO value.
 */
import type { MetadataRoute } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { isIndexable } from '@/lib/is-indexable'
import { venueSlug } from '@/lib/slug'

const BASE_URL = 'https://pourlist.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabaseServer
    .from('venues')
    .select('id, slug, name, hh_type, menu_text, hh_summary, last_verified')
    .not('hh_type', 'is', null)
    .order('name')

  const venueEntries: MetadataRoute.Sitemap = (data ?? [])
    .filter(v => isIndexable(v))
    .map(v => {
      const slug = v.slug ?? venueSlug(v)
      return {
        url: `${BASE_URL}/venue/${slug}`,
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
