/**
 * app/sitemap.ts — Next.js App Router sitemap.
 *
 * Returns qualifying neighborhoods (≥NEIGHBORHOOD_PAGE_THRESHOLD qualifying venues) and geo-complete
 * venues with HH data. No stubs, no seed data.
 */
import type { MetadataRoute } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { slugifyName } from '@/lib/slug'
import { NEIGHBORHOOD_PAGE_THRESHOLD } from '@/lib/neighborhoods'

const BASE_URL = 'https://pourlist.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: allVenues } = await supabaseServer
    .from('venues')
    .select('id, slug, new_slug, name, city, state, neighborhood, hh_type, menu_text, hh_summary, last_verified, needs_geo_review, is_seed_data, status')
    .not('hh_type', 'is', null)
    .order('name')

  if (!allVenues) {
    return [{ url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 }]
  }

  // ── Qualifying neighborhoods ────────────────────────────────────────────────
  const neighborhoodKeys: Record<string, { count: number; state: string; city: string; neighborhood: string }> = {}
  for (const v of allVenues) {
    if (v.is_seed_data === true) continue
    if (v.status !== 'verified') continue
    if (!v.city || !v.state || !v.neighborhood) continue
    const key = `${v.state}/${v.city}/${v.neighborhood}`
    if (!neighborhoodKeys[key]) {
      neighborhoodKeys[key] = { count: 0, state: v.state, city: v.city, neighborhood: v.neighborhood }
    }
    neighborhoodKeys[key].count++
  }

  const neighborhoodEntries: MetadataRoute.Sitemap = Object.values(neighborhoodKeys)
    .filter(n => n.count >= NEIGHBORHOOD_PAGE_THRESHOLD)
    .map(n => {
      const stateSlug = n.state.toLowerCase()
      const citySlug = slugifyName(n.city)
      const nSlug = slugifyName(n.neighborhood)
      return {
        url: `${BASE_URL}/${stateSlug}/${citySlug}/${nSlug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }
    })

  // ── Qualifying venues ──────────────────────────────────────────────────────
  const venueEntries: MetadataRoute.Sitemap = allVenues
    .filter(v => {
      return (
        hasHappyHourData(v) &&
        v.new_slug !== null &&
        v.is_seed_data !== true &&
        v.needs_geo_review !== true
      )
    })
    .map(v => ({
      url: `${BASE_URL}${v.new_slug}`,
      lastModified: v.last_verified ? new Date(v.last_verified) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    ...neighborhoodEntries,
    ...venueEntries,
  ]
}
